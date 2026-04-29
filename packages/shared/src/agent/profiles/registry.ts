/**
 * Profile Registry — accessor + fallback inference.
 *
 * Three lookup paths:
 *
 *   1. Exact match — hand-curated profile from MODEL_PROFILES /
 *      PROVIDER_PROFILES. Use this whenever possible.
 *
 *   2. Family-based fallback — if the exact id misses, derive the family
 *      from the id (e.g. 'claude-opus-4-7-20260315' -> 'claude-opus-4-7'
 *      via alias expansion or version suffix stripping) and try again.
 *
 *   3. Conservative inference — for completely unknown ids, build a minimal
 *      ModelProfile from the id alone with safe defaults (no thinking,
 *      sampling allowed, no betas). UI should surface this as "unknown
 *      capabilities — using conservative defaults".
 *
 * Same shape applies to providers — given a (providerType, baseUrl) hint,
 * pick the most specific profile, falling back to PI_COMPAT_CUSTOM or
 * UNKNOWN.
 */

import type {
  ModelProfile,
  ProviderProfile,
  ProviderProfileId,
} from './types.ts';
import {
  MODEL_PROFILES,
  ALL_MODEL_PROFILES,
} from './model-profiles.ts';
import {
  PROVIDER_PROFILES,
  ALL_PROVIDER_PROFILES,
} from './provider-profiles.ts';

/** Build the alias index once at module load. */
const ALIAS_INDEX: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  for (const profile of ALL_MODEL_PROFILES) {
    if (profile.aliasIds) {
      for (const alias of profile.aliasIds) {
        index[alias] = profile.canonicalId;
      }
    }
  }
  return index;
})();

/**
 * Resolve a model id to its canonical form. Handles:
 *   - Direct canonical id (returned as-is)
 *   - Alias ids (e.g. 'claude-haiku-4-5' -> 'claude-haiku-4-5-20251001')
 *   - Dated suffixes (strips -YYYYMMDD)
 *   - Provider-prefixed forms ('pi/claude-opus-4-7' -> 'claude-opus-4-7',
 *     'anthropic/claude-opus-4.7' -> 'claude-opus-4-7' if it matches)
 *   - Bedrock-native ids ('us.anthropic.claude-opus-4-7-v1' -> 'claude-opus-4-7')
 *
 * Returns the input unchanged if no match — caller should treat that
 * as the canonical id of an unknown model.
 */
export function canonicalizeModelId(id: string): string {
  if (id in MODEL_PROFILES) return id;
  if (id in ALIAS_INDEX) return ALIAS_INDEX[id]!;

  // Strip 'pi/' prefix
  if (id.startsWith('pi/')) {
    const stripped = id.slice('pi/'.length);
    return canonicalizeModelId(stripped);
  }

  // Strip vendor prefix used by OpenRouter-style ids ('anthropic/claude-opus-4.7')
  // Convert dots in version segments back to dashes for matching.
  if (id.includes('/')) {
    const tail = id.split('/').pop()!;
    const dashed = tail.replace(/\./g, '-');
    if (dashed in MODEL_PROFILES) return dashed;
    if (dashed in ALIAS_INDEX) return ALIAS_INDEX[dashed]!;
  }

  // Bedrock native: 'us.anthropic.claude-opus-4-7-v1' -> 'claude-opus-4-7'
  // Strip region prefix and '.v?' suffix.
  const bedrockMatch = id.match(/^(?:us|eu|global)?\.?anthropic\.(.+?)(?:-v\d+(?::\d+)?)?$/);
  if (bedrockMatch?.[1]) {
    const inner = bedrockMatch[1];
    if (inner in MODEL_PROFILES) return inner;
    if (inner in ALIAS_INDEX) return ALIAS_INDEX[inner]!;
  }

  // Strip dated suffix '-YYYYMMDD' or '-YYYYMMDD-vN'
  const dateStripped = id.replace(/-\d{8}(-v\d+)?$/, '');
  if (dateStripped !== id && dateStripped in MODEL_PROFILES) return dateStripped;
  if (dateStripped !== id && dateStripped in ALIAS_INDEX) return ALIAS_INDEX[dateStripped]!;

  return id;
}

/**
 * Look up a ModelProfile. Returns the hand-curated profile if found,
 * otherwise builds a conservative inferred profile from the id.
 */
export function getModelProfile(modelId: string): ModelProfile {
  const canonical = canonicalizeModelId(modelId);
  const exact = (MODEL_PROFILES as Record<string, ModelProfile | undefined>)[canonical];
  if (exact) return exact;
  return inferUnknownModelProfile(modelId);
}

/**
 * Build a conservative ModelProfile for an unknown id. Used when a user
 * wires up a model the registry doesn't know about (e.g., a brand-new
 * OpenRouter model). Defaults err on the side of "send fewer features"
 * to avoid 400s.
 */
export function inferUnknownModelProfile(id: string): ModelProfile {
  const lower = id.toLowerCase();

  // Family inference (best effort).
  let family: ModelProfile['family'] = 'unknown';
  let vendor: ModelProfile['vendor'] = 'unknown';
  if (lower.includes('claude-opus')) { family = 'claude-opus'; vendor = 'anthropic'; }
  else if (lower.includes('claude-sonnet')) { family = 'claude-sonnet'; vendor = 'anthropic'; }
  else if (lower.includes('claude-haiku')) { family = 'claude-haiku'; vendor = 'anthropic'; }
  else if (lower.includes('claude-mythos')) { family = 'claude-mythos'; vendor = 'anthropic'; }
  else if (lower.includes('codex')) { family = 'gpt-codex'; vendor = 'openai'; }
  else if (/o[1-9](?:-|$)/.test(lower)) { family = 'gpt-o-reasoning'; vendor = 'openai'; }
  else if (lower.startsWith('gpt')) { family = 'gpt'; vendor = 'openai'; }
  else if (lower.includes('gemini')) { family = 'gemini'; vendor = 'google'; }
  else if (lower.includes('deepseek')) { family = 'deepseek'; vendor = 'deepseek'; }
  else if (lower.includes('kimi')) { family = 'kimi-coding'; vendor = 'kimi'; }
  else if (lower.includes('glm')) { family = 'glm'; vendor = 'zai'; }
  else if (lower.includes('minimax')) { family = 'minimax'; vendor = 'minimax'; }
  else if (lower.includes('qwen')) { family = 'qwen'; vendor = 'qwen'; }

  return {
    canonicalId: id,
    displayName: id,
    shortName: id.split(/[-/]/).pop() ?? id,
    family,
    vendor,
    contextWindow: 128_000,
    capabilities: {
      thinking: { kind: 'none' },
      samplingParams: 'allowed',
      promptCaching: 'none',
      cacheTtl1h: false,
      fastMode: false,
      interleavedThinking: 'unsupported',
      taskBudgets: false,
      pdfInput: false,
      citations: false,
      visionInput: false,
      audioInput: false,
      parallelToolUse: false,
    },
    defaults: {
      minMaxTokens: 4_096,
      recommendedMaxTokens: 4_096,
    },
    tokenizerInflation: 1.0,
  };
}

// ============================================================
// Provider profile lookup
// ============================================================

export interface ProviderLookupHint {
  /** Stable id when known — short-circuits all heuristics. */
  providerProfileId?: ProviderProfileId;
  /** From LlmConnection.providerType — 'anthropic' | 'pi' | 'pi_compat'. */
  legacyProviderType?: 'anthropic' | 'pi' | 'pi_compat';
  /** From LlmConnection.piAuthProvider when providerType === 'pi'. */
  piAuthProvider?: string;
  /** From LlmConnection.baseUrl — overrides protocol-default endpoint. */
  baseUrl?: string;
  /** From LlmConnection.authType — distinguishes oauth vs api_key. */
  authType?: 'api_key' | 'api_key_with_endpoint' | 'oauth' | 'iam_credentials' | 'bearer_token' | 'service_account_file' | 'environment' | 'none';
}

const NATIVE_ANTHROPIC_BASE = 'https://api.anthropic.com';

/**
 * Resolve a ProviderProfile from an LlmConnection-shaped hint.
 *
 * Decision order:
 *   1. providerProfileId, if explicitly given
 *   2. anthropic providerType + native baseUrl + oauth authType -> anthropic-oauth
 *   3. anthropic providerType + native baseUrl -> anthropic-native
 *   4. anthropic providerType + custom baseUrl -> pi-openrouter / pi-compat-custom
 *      (best-effort: known custom hosts route to the matching pi profile)
 *   5. pi providerType + piAuthProvider -> matching pi-* profile
 *   6. pi_compat -> pi-compat-custom
 *   7. fallback -> unknown
 */
export function getProviderProfile(hint: ProviderLookupHint): ProviderProfile {
  if (hint.providerProfileId && hint.providerProfileId in PROVIDER_PROFILES) {
    return PROVIDER_PROFILES[hint.providerProfileId];
  }

  const baseUrl = hint.baseUrl?.trim();

  if (hint.legacyProviderType === 'anthropic') {
    const isNative = !baseUrl || baseUrl === NATIVE_ANTHROPIC_BASE;
    if (isNative) {
      return hint.authType === 'oauth'
        ? PROVIDER_PROFILES['anthropic-oauth']
        : PROVIDER_PROFILES['anthropic-native'];
    }
    // Custom Anthropic baseUrl — try to match a known third-party
    if (baseUrl) {
      const match = matchKnownBaseUrl(baseUrl);
      if (match) return match;
    }
    // Otherwise treat as a custom endpoint with conservative caps
    return PROVIDER_PROFILES['pi-compat-custom'];
  }

  if (hint.legacyProviderType === 'pi' && hint.piAuthProvider) {
    const piProfile = piAuthProviderToProfile(hint.piAuthProvider);
    if (piProfile) return piProfile;
  }

  if (hint.legacyProviderType === 'pi_compat') {
    return PROVIDER_PROFILES['pi-compat-custom'];
  }

  // Unknown — last-resort fallback. The resolver should still produce a
  // valid (if minimal) request for unknown providers.
  return PROVIDER_PROFILES.unknown;
}

const PI_AUTH_PROVIDER_MAP: Record<string, ProviderProfileId> = {
  anthropic: 'anthropic-native',
  openai: 'pi-openai-apikey',
  google: 'pi-google-aistudio',
  'openai-codex': 'pi-codex-oauth',
  'github-copilot': 'pi-copilot-oauth',
  openrouter: 'pi-openrouter',
  deepseek: 'pi-deepseek',
  'kimi-coding': 'pi-kimi',
  zai: 'pi-zai',
  minimax: 'pi-minimax',
};

function piAuthProviderToProfile(piAuthProvider: string): ProviderProfile | undefined {
  const id = PI_AUTH_PROVIDER_MAP[piAuthProvider];
  return id ? PROVIDER_PROFILES[id] : undefined;
}

function matchKnownBaseUrl(baseUrl: string): ProviderProfile | undefined {
  const lower = baseUrl.toLowerCase();
  for (const profile of ALL_PROVIDER_PROFILES) {
    if (profile.baseUrl && lower.startsWith(profile.baseUrl.toLowerCase())) {
      return profile;
    }
  }
  return undefined;
}

/**
 * Recommended default ThinkingLevel for a model. Replaces the global
 * DEFAULT_THINKING_LEVEL fallback so each model can opt into the level
 * its vendor recommends — e.g. Opus 4.7 -> 'xhigh' (Anthropic's
 * documented recommendation), Opus 4.6 -> 'medium', Haiku -> 'low'.
 *
 * Falls back to 'medium' for unknown models so behaviour stays sane
 * without registry coverage.
 */
export function getRecommendedThinkingLevelForModel(modelId: string): import('../thinking-levels.ts').ThinkingLevel {
  const profile = getModelProfile(modelId);
  return profile.defaults.recommendedThinkingLevel ?? 'medium';
}

// Re-exports for convenience
export { MODEL_PROFILES, ALL_MODEL_PROFILES };
export { PROVIDER_PROFILES, ALL_PROVIDER_PROFILES };
