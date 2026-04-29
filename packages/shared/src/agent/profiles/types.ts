/**
 * Profile / Capability Types
 *
 * The data backbone of the (Model x Provider x Capability) matrix. Lets us
 * answer "given this model going through this provider, what params can/can't
 * I send" as a pure data lookup instead of scattered if/else.
 *
 * See docs/analysis/opus-4-7-thinking-bugs.md for the design rationale.
 *
 * Three top-level concepts:
 *   - ModelProfile      — what Opus 4.7 (or any model) can do, provider-agnostic
 *   - ProviderProfile   — what OpenRouter (or any provider/gateway) forwards
 *   - ModelMapping      — binding of canonicalId + providerProfileId -> providerSpecificId
 *
 * Plus the resolver I/O types:
 *   - UserIntent        — what the user asked for (provider/model-agnostic)
 *   - ResolvedRequest   — what to actually send (after capability intersection)
 *   - ResolverWarning   — why a downgrade or strip happened (surface to UI)
 */

import type { ThinkingLevel } from '../thinking-levels.ts';

// ============================================================
// Shared primitives
// ============================================================

/** Anthropic effort dial (Opus 4.6+; xhigh exclusive to Opus 4.7). */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** OpenAI-style reasoning effort (o1/o3 family). */
export type OpenAiReasoningEffort = 'low' | 'medium' | 'high';

/** Anthropic thinking.display field values. */
export type ThinkingDisplay = 'summarized' | 'omitted';

// ============================================================
// ModelProfile
// ============================================================

/**
 * How a model exposes its thinking/reasoning surface.
 *
 * Discriminated by `kind`:
 *   - 'adaptive'         — Anthropic Opus 4.6+, has effort dial + display field
 *   - 'enabled-budget'   — Older Claude / Haiku — fixed budgetTokens budget
 *   - 'reasoning-effort' — OpenAI o1/o3 family — three-level effort
 *   - 'none'             — Model has no thinking concept
 */
export type ModelThinkingCapability =
  | {
      kind: 'adaptive';
      /** Effort levels accepted by this model. */
      effortLevels: readonly EffortLevel[];
      /** Whether the model accepts the `thinking.display` field. */
      displayField: boolean;
    }
  | {
      kind: 'enabled-budget';
      minBudget: number;
      maxBudget: number;
    }
  | {
      kind: 'reasoning-effort';
      effortLevels: readonly OpenAiReasoningEffort[];
    }
  | { kind: 'none' };

/** Whether the model accepts non-default sampling params (temperature/top_p/top_k). */
export type SamplingParamPolicy = 'allowed' | 'forbidden';

/** Beta-tagged 1M context-window opt-in. */
export interface OneMillionContextSpec {
  /** Beta header that opts the request into 1M context. */
  betaHeader: string;
  /** Optional model id suffix (e.g. `[1m]`) — set when the OAuth path needs it. */
  modelSuffix?: string;
}

export type InterleavedThinkingSupport =
  | 'always-on'      // Auto-enabled with adaptive thinking (Opus 4.7+)
  | 'opt-in-beta'    // Requires interleaved-thinking-* beta header
  | 'deprecated'     // Still accepted but ignored (transition state)
  | 'unsupported';

export type PromptCachingMode = 'cache_control' | 'auto' | 'none';

export interface ModelCapabilities {
  thinking: ModelThinkingCapability;
  samplingParams: SamplingParamPolicy;
  /** When set, the model has a 1M context option behind a beta. */
  contextWindow1M?: OneMillionContextSpec;
  promptCaching: PromptCachingMode;
  /** Whether `cache_control.ttl: '1h'` is accepted. */
  cacheTtl1h: boolean;
  /** Whether the speed=fast / fast-mode path is supported. */
  fastMode: boolean;
  interleavedThinking: InterleavedThinkingSupport;
  /** Either a beta header spec or false if task budgets aren't supported. */
  taskBudgets: { betaHeader: string } | false;
  pdfInput: boolean;
  citations: boolean;
  visionInput: boolean;
  audioInput: boolean;
  parallelToolUse: boolean;
}

/** Per-model defaults — used at UI initial state and as resolver floors. */
export interface ModelDefaults {
  thinkingDisplay?: ThinkingDisplay;
  /** Floor for max_tokens. The resolver picks `max(intent, minMaxTokens)`. */
  minMaxTokens?: number;
  recommendedMaxTokens?: number;
  recommendedThinkingLevel?: ThinkingLevel;
  recommendedEffort?: EffortLevel;
}

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cached input tokens (when prompt caching is used). */
  cachedInput?: number;
  /** USD per million thinking tokens, if separately metered. */
  thinking?: number;
}

export type ModelVendor =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'meta'
  | 'mistral'
  | 'deepseek'
  | 'kimi'
  | 'zai'
  | 'minimax'
  | 'qwen'
  | 'unknown';

export type ModelFamily =
  | 'claude-opus'
  | 'claude-sonnet'
  | 'claude-haiku'
  | 'claude-mythos'
  | 'gpt'
  | 'gpt-codex'
  | 'gpt-o-reasoning'
  | 'gemini'
  | 'deepseek'
  | 'kimi-coding'
  | 'glm'
  | 'minimax'
  | 'qwen'
  | 'unknown';

/** Authoritative description of a single model — provider-agnostic. */
export interface ModelProfile {
  /** Canonical app-layer identity (e.g. 'claude-opus-4-7'). */
  canonicalId: string;
  /** UI label (e.g. 'Opus 4.7'). */
  displayName: string;
  shortName: string;
  family: ModelFamily;
  vendor: ModelVendor;
  /** Optional version split — used by family-based fallback. */
  version?: { major: number; minor: number };
  contextWindow: number;
  capabilities: ModelCapabilities;
  defaults: ModelDefaults;
  pricing?: ModelPricing;
  /** Token-count multiplier vs older Claude tokenizer (e.g. Opus 4.7 ≈ 1.2). */
  tokenizerInflation?: number;
  /** Aliases that should resolve to this profile (e.g. dated release ids). */
  aliasIds?: readonly string[];
}

// ============================================================
// ProviderProfile
// ============================================================

/**
 * Stable identifier for a routing entry-point. Each represents a (transport,
 * authentication, baseUrl) combination — independent of which model flows
 * through it.
 */
export type ProviderProfileId =
  // Direct Anthropic
  | 'anthropic-native'
  | 'anthropic-oauth'
  // Pi backend — first-class providers
  | 'pi-openai-apikey'
  | 'pi-google-aistudio'
  | 'pi-codex-oauth'
  | 'pi-copilot-oauth'
  | 'pi-openrouter'
  | 'pi-deepseek'
  | 'pi-kimi'
  | 'pi-zai'
  | 'pi-minimax'
  // Custom endpoint (Ollama, vLLM, self-hosted, anthropic-compat etc.)
  | 'pi-compat-custom'
  // Fallback for unknown / unmapped routing
  | 'unknown';

export type ProviderProtocol =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'anthropic-bedrock'
  | 'gemini-generate';

export type ProviderTransport = 'sdk-claude' | 'subprocess-pi' | 'sdk-bedrock';

export type ProviderAuthStyle =
  | 'x-api-key'
  | 'bearer'
  | 'oauth'
  | 'aws-sigv4'
  | 'gcp-iam'
  | 'none';

/**
 * What the provider's transport layer is willing to forward to the upstream
 * model. A model may *support* `effort: 'xhigh'`, but if the provider strips
 * the field on the way through, the effective capability is gone.
 */
export interface ProviderRoutingCapabilities {
  forwardsThinkingType: 'all' | 'adaptive-only' | 'enabled-only' | 'none';
  forwardsEffort: boolean;
  forwardsBetaHeaders: 'all' | 'whitelist' | 'none';
  forwardsToolChoice: boolean;
  forwardsCacheControl: 'full' | 'partial' | 'none';
  /** If true, provider auto-downgrades unsupported effort to 'high' silently. */
  silentlyDowngradesEffort: boolean;
}

export interface ProviderProfile {
  id: ProviderProfileId;
  /** UI label. */
  displayName: string;
  protocol: ProviderProtocol;
  transport: ProviderTransport;
  /** Default base URL when applicable; null for subprocess-only. */
  baseUrl: string | null;
  authStyle: ProviderAuthStyle;
  routingCapabilities: ProviderRoutingCapabilities;
  /**
   * Translate a canonical model id into the provider-specific shape.
   * Default identity if absent.
   */
  modelIdTransform?: (canonicalId: string) => string;
  /** Notes shown alongside the provider in UI. */
  notes?: string;
}

// ============================================================
// ModelMapping
// ============================================================

/** Binding of canonical model x provider profile -> concrete provider model id. */
export interface ModelMapping {
  canonicalId: string;
  providerProfileId: ProviderProfileId;
  providerSpecificId: string;
  availability: 'available' | 'unavailable' | 'preview' | 'deprecated';
  /**
   * Per-(model, provider) capability override. Use sparingly — only when a
   * provider has a specific limitation or extension on this model that's not
   * captured by the generic ProviderProfile capability filter.
   */
  capabilityOverrides?: Partial<ModelCapabilities>;
  qualityScore?: number;
  notes?: string;
}

// ============================================================
// Resolver I/O
// ============================================================

/** What the user/caller asked for. Provider-agnostic. */
export interface UserIntent {
  thinkingLevel: ThinkingLevel;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  enable1MContext?: boolean;
  fastMode?: boolean;
  /** Mini-agent shortcut: force-disable thinking. */
  minimizeThinking?: boolean;
}

/** Why the resolver downgraded or stripped something. Surface to user. */
export interface ResolverWarning {
  kind:
    | 'effort-downgraded'
    | 'param-stripped'
    | 'thinking-disabled'
    | 'thinking-budget-clamped'
    | 'capability-mismatch';
  field?: string;
  from?: string | number;
  to?: string | number;
  reason: string;
}

/** SDK-shape params the resolver wants the call site to pass. */
export interface ResolvedSdkParams {
  /** Final model id after providerProfile.modelIdTransform. */
  model?: string;
  thinking?:
    | { type: 'adaptive'; display?: ThinkingDisplay }
    | { type: 'enabled'; budgetTokens: number }
    | { type: 'disabled' };
  /** Anthropic adaptive effort (only set when thinking.type === 'adaptive'). */
  effort?: EffortLevel;
  /** OpenAI reasoning_effort (only set for reasoning-effort models). */
  reasoningEffort?: OpenAiReasoningEffort;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Anthropic 'speed: fast' opt-in. */
  speed?: 'fast';
}

export interface ResolvedRequest {
  params: ResolvedSdkParams;
  /** Extra headers to merge — e.g. beta opt-ins. */
  headers: Record<string, string>;
  warnings: ResolverWarning[];
}

/**
 * Effective capability after intersecting model x provider x mapping
 * overrides. Used internally by the resolver, exported for white-box tests.
 */
export interface EffectiveCapability {
  thinking: ModelThinkingCapability;
  samplingParams: SamplingParamPolicy;
  contextWindow1M?: OneMillionContextSpec;
  fastMode: boolean;
  forwardsBetaHeaders: ProviderRoutingCapabilities['forwardsBetaHeaders'];
  silentlyDowngradesEffort: boolean;
}
