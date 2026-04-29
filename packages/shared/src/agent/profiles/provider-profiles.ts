/**
 * Provider Profiles — the 12 mainstream routing entry-points.
 *
 * Provider here means a (transport, authentication, baseUrl) combination.
 * Not the model; not the vendor. OpenRouter is one provider profile;
 * Bedrock is another — both can route the same model with different
 * routing capability (e.g. OpenRouter doesn't forward Anthropic's `effort`
 * field today, even when it routes Opus 4.7).
 *
 * UI-pruned in April 2026 — see docs/analysis/opus-4-7-thinking-bugs.md.
 * To re-enable a hidden provider, drop a profile here AND remove its key
 * from PI_EXCLUDED_PROVIDERS in packages/shared/src/config/models-pi.ts.
 *
 * `routingCapabilities` describes what this provider's transport will
 * forward. Conservative defaults are used when the actual behaviour is
 * uncertain — better to send fewer features and have the model work than
 * to send everything and 400.
 */

import type { ProviderProfile } from './types.ts';

// ============================================================
// Anthropic — direct
// ============================================================

const ANTHROPIC_NATIVE: ProviderProfile = {
  id: 'anthropic-native',
  displayName: 'Anthropic',
  protocol: 'anthropic-messages',
  transport: 'sdk-claude',
  baseUrl: 'https://api.anthropic.com',
  authStyle: 'x-api-key',
  routingCapabilities: {
    forwardsThinkingType: 'all',
    forwardsEffort: true,
    forwardsBetaHeaders: 'all',
    forwardsToolChoice: true,
    forwardsCacheControl: 'full',
    silentlyDowngradesEffort: true,
  },
};

const ANTHROPIC_OAUTH: ProviderProfile = {
  id: 'anthropic-oauth',
  displayName: 'Claude Pro / Max',
  protocol: 'anthropic-messages',
  transport: 'sdk-claude',
  baseUrl: 'https://api.anthropic.com',
  authStyle: 'oauth',
  routingCapabilities: {
    forwardsThinkingType: 'all',
    forwardsEffort: true,
    forwardsBetaHeaders: 'all',
    forwardsToolChoice: true,
    forwardsCacheControl: 'full',
    silentlyDowngradesEffort: true,
  },
};

// ============================================================
// Pi backend — first-class providers
// ============================================================

const PI_OPENAI_APIKEY: ProviderProfile = {
  id: 'pi-openai-apikey',
  displayName: 'OpenAI',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: 'https://api.openai.com/v1',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_GOOGLE_AISTUDIO: ProviderProfile = {
  id: 'pi-google-aistudio',
  displayName: 'Google AI Studio',
  protocol: 'gemini-generate',
  transport: 'subprocess-pi',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_CODEX_OAUTH: ProviderProfile = {
  id: 'pi-codex-oauth',
  displayName: 'ChatGPT Plus / Codex',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: null, // Codex OAuth uses managed endpoint, varies by user
  authStyle: 'oauth',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_COPILOT_OAUTH: ProviderProfile = {
  id: 'pi-copilot-oauth',
  displayName: 'GitHub Copilot',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: null,
  authStyle: 'oauth',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'whitelist',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_OPENROUTER: ProviderProfile = {
  id: 'pi-openrouter',
  displayName: 'OpenRouter',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: 'https://openrouter.ai/api',
  authStyle: 'bearer',
  routingCapabilities: {
    // OpenRouter is best-effort for Anthropic adaptive thinking — passes
    // through but doesn't currently forward the Anthropic `effort` field.
    forwardsThinkingType: 'all',
    forwardsEffort: false,
    forwardsBetaHeaders: 'whitelist',
    forwardsToolChoice: true,
    forwardsCacheControl: 'partial',
    silentlyDowngradesEffort: false,
  },
};

const PI_DEEPSEEK: ProviderProfile = {
  id: 'pi-deepseek',
  displayName: 'DeepSeek',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: 'https://api.deepseek.com',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_KIMI: ProviderProfile = {
  id: 'pi-kimi',
  displayName: 'Kimi (Coding)',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: 'https://api.kimi.com/coding',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_ZAI: ProviderProfile = {
  id: 'pi-zai',
  displayName: 'z.ai (GLM)',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

const PI_MINIMAX: ProviderProfile = {
  id: 'pi-minimax',
  displayName: 'Minimax',
  protocol: 'anthropic-messages',
  transport: 'subprocess-pi',
  baseUrl: 'https://api.minimax.io/anthropic',
  authStyle: 'bearer',
  routingCapabilities: {
    forwardsThinkingType: 'enabled-only',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

// ============================================================
// pi_compat — generic custom endpoint
// ============================================================

const PI_COMPAT_CUSTOM: ProviderProfile = {
  id: 'pi-compat-custom',
  displayName: 'Custom Endpoint',
  // Protocol depends on the custom endpoint config (anthropic-messages or openai-completions).
  // This profile defaults to openai-completions; resolver should narrow at runtime if known.
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: null,
  authStyle: 'bearer',
  routingCapabilities: {
    // Conservative — we don't know what arbitrary endpoints support.
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: true,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
  notes: 'Capability filter is conservative — extend per-(model, mapping) when a known endpoint supports more.',
};

// ============================================================
// Fallback for unknown routing
// ============================================================

const UNKNOWN_PROVIDER: ProviderProfile = {
  id: 'unknown',
  displayName: 'Unknown Provider',
  protocol: 'openai-completions',
  transport: 'subprocess-pi',
  baseUrl: null,
  authStyle: 'none',
  routingCapabilities: {
    forwardsThinkingType: 'none',
    forwardsEffort: false,
    forwardsBetaHeaders: 'none',
    forwardsToolChoice: false,
    forwardsCacheControl: 'none',
    silentlyDowngradesEffort: false,
  },
};

export const PROVIDER_PROFILES = {
  'anthropic-native': ANTHROPIC_NATIVE,
  'anthropic-oauth': ANTHROPIC_OAUTH,
  'pi-openai-apikey': PI_OPENAI_APIKEY,
  'pi-google-aistudio': PI_GOOGLE_AISTUDIO,
  'pi-codex-oauth': PI_CODEX_OAUTH,
  'pi-copilot-oauth': PI_COPILOT_OAUTH,
  'pi-openrouter': PI_OPENROUTER,
  'pi-deepseek': PI_DEEPSEEK,
  'pi-kimi': PI_KIMI,
  'pi-zai': PI_ZAI,
  'pi-minimax': PI_MINIMAX,
  'pi-compat-custom': PI_COMPAT_CUSTOM,
  unknown: UNKNOWN_PROVIDER,
} as const satisfies Record<string, ProviderProfile>;

export const ALL_PROVIDER_PROFILES: readonly ProviderProfile[] = [
  ANTHROPIC_NATIVE,
  ANTHROPIC_OAUTH,
  PI_OPENAI_APIKEY,
  PI_GOOGLE_AISTUDIO,
  PI_CODEX_OAUTH,
  PI_COPILOT_OAUTH,
  PI_OPENROUTER,
  PI_DEEPSEEK,
  PI_KIMI,
  PI_ZAI,
  PI_MINIMAX,
  PI_COMPAT_CUSTOM,
];

/** First-class providers (excludes UNKNOWN fallback). */
export const FIRST_CLASS_PROVIDER_PROFILES = ALL_PROVIDER_PROFILES;
