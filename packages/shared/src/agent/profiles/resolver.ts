/**
 * Capability Resolver — pure function from (intent x model x provider)
 * to a sanitized SDK request shape + warnings.
 *
 * No I/O, no SDK calls. Test it as data.
 *
 * Decision flow:
 *
 *   1. Compute EffectiveCapability = intersect(model.capabilities,
 *      provider.routingCapabilities, mapping.capabilityOverrides).
 *      "Effective" means: what we can actually expect to work end-to-end.
 *
 *   2. Build thinking params per effective.thinking.kind:
 *      - 'adaptive' + adaptive-thinking-supported provider:
 *          { type: 'adaptive', display: <model default> } + effort
 *      - 'enabled-budget':
 *          { type: 'enabled', budgetTokens: <from level + clamp> }
 *      - 'reasoning-effort':
 *          reasoning_effort = mapped level
 *      - 'none' or thinking off:
 *          { type: 'disabled' } when supported, otherwise omit thinking
 *
 *   3. Build sampling params per effective.samplingParams:
 *      - 'forbidden': drop temperature/top_p/top_k, emit param-stripped
 *        warning when intent had any
 *      - 'allowed': pass through
 *
 *   4. maxTokens = max(intent.maxTokens, modelProfile.defaults.minMaxTokens)
 *
 *   5. 1M context: when contextWindow1M is supported and intent allows,
 *      apply modelSuffix + add beta header (if provider forwards betas)
 *
 *   6. fastMode: only emit when both model and provider support it
 *
 *   7. Final model id: providerProfile.modelIdTransform(canonicalId)
 *
 * Every downgrade is recorded in warnings for the call site to surface.
 */

import type { ThinkingLevel } from '../thinking-levels.ts';
import type {
  ModelProfile,
  ProviderProfile,
  ResolvedRequest,
  ResolvedSdkParams,
  ResolverWarning,
  UserIntent,
  EffectiveCapability,
  EffortLevel,
  ModelThinkingCapability,
  OneMillionContextSpec,
  ThinkingDisplay,
} from './types.ts';

// ============================================================
// Mapping helpers (level -> SDK token)
// ============================================================

/** Craft thinking level -> Anthropic effort level. Off returns null. */
const THINKING_LEVEL_TO_EFFORT: Record<ThinkingLevel, EffortLevel | null> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/** Craft thinking level -> OpenAI reasoning effort. Off returns null. */
const THINKING_LEVEL_TO_OPENAI_EFFORT: Record<ThinkingLevel, 'low' | 'medium' | 'high' | null> = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high', // OpenAI tops out at 'high'
  max: 'high',
};

/**
 * Token budget per Craft thinking level for the enabled-budget thinking shape.
 * Used by Haiku and other budget-only models. Scaled to the model's max
 * budget at clamp time.
 */
const THINKING_LEVEL_TO_BUDGET_RATIO: Record<ThinkingLevel, number> = {
  off: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  xhigh: 0.875,
  max: 1.0,
};

const EFFORT_RANK: Record<EffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 4,
};

/** Pick the highest supported effort that is <= the requested level. */
function downgradeEffort(
  requested: EffortLevel,
  supported: readonly EffortLevel[],
): EffortLevel {
  if (supported.includes(requested)) return requested;
  // Find the highest supported effort with rank <= requested rank
  const requestedRank = EFFORT_RANK[requested];
  let best: EffortLevel | undefined;
  for (const e of supported) {
    if (EFFORT_RANK[e] <= requestedRank && (!best || EFFORT_RANK[e] > EFFORT_RANK[best])) {
      best = e;
    }
  }
  // If everything supported is *above* the requested rank, just pick the lowest supported.
  if (!best) {
    let lowest = supported[0]!;
    for (const e of supported) {
      if (EFFORT_RANK[e] < EFFORT_RANK[lowest]) lowest = e;
    }
    return lowest;
  }
  return best;
}

// ============================================================
// Effective capability intersection
// ============================================================

/**
 * Combine model + provider into the actual capability that will work.
 *
 * - Thinking: model declares the kind; provider can knock 'adaptive' down
 *   to 'enabled-budget' or 'none' depending on what it forwards.
 * - Effort: filtered down by provider.forwardsEffort (if false, effort
 *   levels collapse to whatever the provider does forward — 'high' is the
 *   conservative default since most providers accept it as adaptive's
 *   intrinsic default).
 * - Sampling: model is authoritative.
 * - 1M context: needs both model support + provider forwarding betas.
 * - Fast mode: needs model support (provider-side is request body, not
 *   beta header — works through any provider that forwards the body).
 */
export function intersectCapabilities(
  model: ModelProfile,
  provider: ProviderProfile,
): EffectiveCapability {
  let thinking: ModelThinkingCapability = model.capabilities.thinking;
  const r = provider.routingCapabilities;

  // Provider doesn't forward thinking at all -> downgrade to 'none'
  if (r.forwardsThinkingType === 'none') {
    thinking = { kind: 'none' };
  } else if (thinking.kind === 'adaptive') {
    // Provider only accepts the older 'enabled' shape -> degrade adaptive
    if (r.forwardsThinkingType === 'enabled-only') {
      thinking = { kind: 'none' }; // No effort to map; model expects adaptive
    } else if (!r.forwardsEffort) {
      // Adaptive thinking still works, but effort dial is dropped on the
      // wire. Keep 'adaptive' kind but mark via narrowed effortLevels so
      // the resolver knows what to emit.
      thinking = {
        kind: 'adaptive',
        effortLevels: [], // signal: provider strips effort entirely
        displayField: thinking.displayField,
      };
    }
    // else: full adaptive support; carry through unchanged
  } else if (thinking.kind === 'enabled-budget' && r.forwardsThinkingType === 'adaptive-only') {
    thinking = { kind: 'none' };
  }

  return {
    thinking,
    samplingParams: model.capabilities.samplingParams,
    contextWindow1M: model.capabilities.contextWindow1M,
    fastMode: model.capabilities.fastMode,
    forwardsBetaHeaders: r.forwardsBetaHeaders,
    silentlyDowngradesEffort: r.silentlyDowngradesEffort,
  };
}

// ============================================================
// The resolver
// ============================================================

export function resolveRequestParams(
  intent: UserIntent,
  model: ModelProfile,
  provider: ProviderProfile,
): ResolvedRequest {
  const warnings: ResolverWarning[] = [];
  const headers: Record<string, string> = {};
  const params: ResolvedSdkParams = {};

  const effective = intersectCapabilities(model, provider);

  // --------------------------------------------------------------
  // 1. Thinking
  // --------------------------------------------------------------
  if (intent.minimizeThinking) {
    if (effective.thinking.kind === 'adaptive' || effective.thinking.kind === 'enabled-budget') {
      params.thinking = { type: 'disabled' };
    }
  } else {
    applyThinking(intent, model, effective, params, warnings);
  }

  // --------------------------------------------------------------
  // 2. Sampling params
  // --------------------------------------------------------------
  applySamplingParams(intent, effective, params, warnings, model.canonicalId);

  // --------------------------------------------------------------
  // 3. maxTokens floor
  // --------------------------------------------------------------
  const minMax = model.defaults.minMaxTokens;
  if (minMax !== undefined) {
    params.maxTokens = Math.max(intent.maxTokens ?? 0, minMax);
  } else if (intent.maxTokens !== undefined) {
    params.maxTokens = intent.maxTokens;
  }

  // --------------------------------------------------------------
  // 4. 1M context window opt-in (model id suffix + beta header)
  // --------------------------------------------------------------
  let modelId = model.canonicalId;
  const supports1M = effective.contextWindow1M;
  const wants1M = intent.enable1MContext !== false;
  if (supports1M && wants1M) {
    modelId = apply1MContext(modelId, supports1M, effective, headers);
  }

  // --------------------------------------------------------------
  // 5. Fast mode
  // --------------------------------------------------------------
  if (intent.fastMode && effective.fastMode) {
    params.speed = 'fast';
  } else if (intent.fastMode && !effective.fastMode) {
    warnings.push({
      kind: 'capability-mismatch',
      field: 'fastMode',
      reason: `Model ${model.canonicalId} does not support fast mode; param dropped`,
    });
  }

  // --------------------------------------------------------------
  // 6. Provider-side model id transform (Bedrock prefixes etc.)
  // --------------------------------------------------------------
  params.model = provider.modelIdTransform ? provider.modelIdTransform(modelId) : modelId;

  return { params, headers, warnings };
}

// ============================================================
// Sub-routines
// ============================================================

function applyThinking(
  intent: UserIntent,
  model: ModelProfile,
  effective: EffectiveCapability,
  params: ResolvedSdkParams,
  warnings: ResolverWarning[],
): void {
  const level = intent.thinkingLevel;
  const t = effective.thinking;

  switch (t.kind) {
    case 'none': {
      if (model.capabilities.thinking.kind !== 'none' && level !== 'off') {
        warnings.push({
          kind: 'thinking-disabled',
          reason: `Provider does not forward thinking for ${model.canonicalId}; running without extended thinking`,
        });
      }
      // Don't set thinking — provider doesn't accept the field
      break;
    }

    case 'adaptive': {
      const requestedEffort = THINKING_LEVEL_TO_EFFORT[level];
      const display: ThinkingDisplay | undefined = t.displayField
        ? model.defaults.thinkingDisplay ?? 'summarized'
        : undefined;

      if (requestedEffort === null) {
        // Off
        params.thinking = { type: 'disabled' };
        return;
      }

      if (t.effortLevels.length === 0) {
        // Provider forwards adaptive thinking but strips the effort field.
        // Emit thinking { type: 'adaptive' } without effort and warn.
        params.thinking = display ? { type: 'adaptive', display } : { type: 'adaptive' };
        warnings.push({
          kind: 'param-stripped',
          field: 'effort',
          from: requestedEffort,
          reason: `Provider does not forward the Anthropic 'effort' field; thinking depth is whatever the upstream defaults to`,
        });
        return;
      }

      const finalEffort = downgradeEffort(requestedEffort, t.effortLevels);
      if (finalEffort !== requestedEffort) {
        warnings.push({
          kind: 'effort-downgraded',
          field: 'effort',
          from: requestedEffort,
          to: finalEffort,
          reason: effective.silentlyDowngradesEffort
            ? `Effort ${requestedEffort} not supported by ${model.canonicalId}; provider auto-downgrades silently`
            : `Effort ${requestedEffort} not supported on this (model, provider); downgraded client-side to ${finalEffort}`,
        });
      }

      params.thinking = display ? { type: 'adaptive', display } : { type: 'adaptive' };
      params.effort = finalEffort;
      break;
    }

    case 'enabled-budget': {
      if (level === 'off') {
        params.thinking = { type: 'enabled', budgetTokens: 0 };
        return;
      }
      const ratio = THINKING_LEVEL_TO_BUDGET_RATIO[level];
      const requested = Math.round(t.maxBudget * ratio);
      const clamped = Math.max(t.minBudget, Math.min(t.maxBudget, requested));
      if (clamped !== requested) {
        warnings.push({
          kind: 'thinking-budget-clamped',
          field: 'budgetTokens',
          from: requested,
          to: clamped,
          reason: `Budget for level=${level} clamped to model bounds [${t.minBudget}, ${t.maxBudget}]`,
        });
      }
      params.thinking = { type: 'enabled', budgetTokens: clamped };
      break;
    }

    case 'reasoning-effort': {
      const mapped = THINKING_LEVEL_TO_OPENAI_EFFORT[level];
      if (mapped === null) {
        // No 'disabled' for OpenAI — just omit the field
        return;
      }
      const supported = t.effortLevels;
      if (supported.includes(mapped)) {
        params.reasoningEffort = mapped;
      } else {
        // Pick the closest available
        const fallback = supported[supported.length - 1] ?? 'medium';
        params.reasoningEffort = fallback;
        warnings.push({
          kind: 'effort-downgraded',
          field: 'reasoning_effort',
          from: mapped,
          to: fallback,
          reason: `OpenAI reasoning_effort=${mapped} not supported by this model; using ${fallback}`,
        });
      }
      break;
    }
  }
}

function applySamplingParams(
  intent: UserIntent,
  effective: EffectiveCapability,
  params: ResolvedSdkParams,
  warnings: ResolverWarning[],
  modelId: string,
): void {
  const policy = effective.samplingParams;
  for (const [field, value] of [
    ['temperature', intent.temperature],
    ['topP', intent.topP],
    ['topK', intent.topK],
  ] as const) {
    if (value === undefined) continue;
    if (policy === 'forbidden') {
      warnings.push({
        kind: 'param-stripped',
        field,
        from: value,
        reason: `${modelId} rejects ${field} (and other sampling params)`,
      });
    } else {
      params[field] = value as never;
    }
  }
}

function apply1MContext(
  baseModelId: string,
  spec: OneMillionContextSpec,
  effective: EffectiveCapability,
  headers: Record<string, string>,
): string {
  const finalId = spec.modelSuffix ? `${baseModelId}${spec.modelSuffix}` : baseModelId;
  if (effective.forwardsBetaHeaders !== 'none') {
    headers['anthropic-beta'] = appendBetaHeader(headers['anthropic-beta'], spec.betaHeader);
  }
  return finalId;
}

function appendBetaHeader(existing: string | undefined, value: string): string {
  if (!existing) return value;
  if (existing.split(',').map((s) => s.trim()).includes(value)) return existing;
  return `${existing},${value}`;
}
