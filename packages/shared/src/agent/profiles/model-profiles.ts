/**
 * Model Profiles — first-party Claude lineup.
 *
 * Authoritative capability + defaults for each model. Drives the
 * capability resolver. When a new model lands, add a profile here and the
 * resolver / UI / cost estimation pick it up automatically.
 *
 * Provider-specific quirks belong in `provider-profiles.ts`, not here.
 *
 * See docs/analysis/opus-4-7-thinking-bugs.md for what changed in Opus 4.7
 * (the source-of-truth for the breaking changes encoded below).
 */

import type { ModelProfile } from './types.ts';

/**
 * Opus 4.7 — primary, full feature set.
 * - adaptive thinking, full effort range incl. xhigh / max
 * - sampling params forbidden (400 on temperature/top_p/top_k)
 * - 1M context behind beta + [1m] suffix for OAuth path
 * - thinking.display defaults to 'omitted' on the wire — we override to 'summarized'
 * - new tokenizer (~1.2x token count vs older Claude)
 * - task budgets via beta header (opt-in)
 */
const OPUS_4_7: ModelProfile = {
  canonicalId: 'claude-opus-4-7',
  displayName: 'Opus 4.7',
  shortName: 'Opus',
  family: 'claude-opus',
  vendor: 'anthropic',
  version: { major: 4, minor: 7 },
  contextWindow: 1_000_000,
  capabilities: {
    thinking: {
      kind: 'adaptive',
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      displayField: true,
    },
    samplingParams: 'forbidden',
    contextWindow1M: { betaHeader: 'context-1m-2025-08-07', modelSuffix: '[1m]' },
    promptCaching: 'cache_control',
    cacheTtl1h: true,
    fastMode: true,
    interleavedThinking: 'always-on',
    taskBudgets: { betaHeader: 'task-budgets-2026-03-13' },
    pdfInput: true,
    citations: true,
    visionInput: true,
    audioInput: false,
    parallelToolUse: true,
  },
  defaults: {
    thinkingDisplay: 'summarized',
    minMaxTokens: 64_000,
    recommendedMaxTokens: 64_000,
    recommendedThinkingLevel: 'xhigh',
    recommendedEffort: 'xhigh',
  },
  tokenizerInflation: 1.2,
  aliasIds: [
    // Bedrock / dated suffixes aliases — added to keep canonicalId resolution
    // robust when the SDK or a connection surfaces a dated id.
    'claude-opus-4-7-latest',
    'claude-mythos-preview', // Pre-release codename, sometimes seen in beta channels
  ],
};

/**
 * Opus 4.6 — previous primary release.
 * - adaptive thinking, no xhigh
 * - max effort still supported
 * - sampling params allowed
 * - 1M context behind beta header (no model suffix needed for 4.6)
 * - interleaved thinking via opt-in beta
 */
const OPUS_4_6: ModelProfile = {
  canonicalId: 'claude-opus-4-6',
  displayName: 'Opus 4.6',
  shortName: 'Opus',
  family: 'claude-opus',
  vendor: 'anthropic',
  version: { major: 4, minor: 6 },
  contextWindow: 200_000,
  capabilities: {
    thinking: {
      kind: 'adaptive',
      effortLevels: ['low', 'medium', 'high', 'max'],
      displayField: true,
    },
    samplingParams: 'allowed',
    contextWindow1M: { betaHeader: 'context-1m-2025-08-07' },
    promptCaching: 'cache_control',
    cacheTtl1h: true,
    fastMode: false,
    interleavedThinking: 'opt-in-beta',
    taskBudgets: false,
    pdfInput: true,
    citations: true,
    visionInput: true,
    audioInput: false,
    parallelToolUse: true,
  },
  defaults: {
    thinkingDisplay: 'summarized',
    minMaxTokens: 32_000,
    recommendedMaxTokens: 32_000,
    recommendedThinkingLevel: 'medium',
    recommendedEffort: 'high',
  },
  tokenizerInflation: 1.0,
};

/**
 * Sonnet 4.6 — everyday workhorse.
 * - adaptive thinking, no xhigh, max supported
 * - sampling params allowed
 */
const SONNET_4_6: ModelProfile = {
  canonicalId: 'claude-sonnet-4-6',
  displayName: 'Sonnet 4.6',
  shortName: 'Sonnet',
  family: 'claude-sonnet',
  vendor: 'anthropic',
  version: { major: 4, minor: 6 },
  contextWindow: 200_000,
  capabilities: {
    thinking: {
      kind: 'adaptive',
      effortLevels: ['low', 'medium', 'high', 'max'],
      displayField: true,
    },
    samplingParams: 'allowed',
    promptCaching: 'cache_control',
    cacheTtl1h: true,
    fastMode: false,
    interleavedThinking: 'opt-in-beta',
    taskBudgets: false,
    pdfInput: true,
    citations: true,
    visionInput: true,
    audioInput: false,
    parallelToolUse: true,
  },
  defaults: {
    thinkingDisplay: 'summarized',
    minMaxTokens: 16_000,
    recommendedMaxTokens: 32_000,
    recommendedThinkingLevel: 'medium',
    recommendedEffort: 'high',
  },
  tokenizerInflation: 1.0,
};

/**
 * Haiku 4.5 — fast / cheap.
 * - No adaptive thinking — uses the older `enabled` budget form
 * - Budget capped at 8k tokens per Anthropic docs
 * - Sampling params allowed
 */
const HAIKU_4_5: ModelProfile = {
  canonicalId: 'claude-haiku-4-5-20251001',
  displayName: 'Haiku 4.5',
  shortName: 'Haiku',
  family: 'claude-haiku',
  vendor: 'anthropic',
  version: { major: 4, minor: 5 },
  contextWindow: 200_000,
  capabilities: {
    thinking: {
      kind: 'enabled-budget',
      minBudget: 0,
      maxBudget: 8_000,
    },
    samplingParams: 'allowed',
    promptCaching: 'cache_control',
    cacheTtl1h: true,
    fastMode: false,
    interleavedThinking: 'unsupported',
    taskBudgets: false,
    pdfInput: true,
    citations: false,
    visionInput: true,
    audioInput: false,
    parallelToolUse: true,
  },
  defaults: {
    thinkingDisplay: undefined,
    minMaxTokens: 4_096,
    recommendedMaxTokens: 8_192,
    recommendedThinkingLevel: 'low',
    // No recommendedEffort — Haiku doesn't use the effort dial.
  },
  tokenizerInflation: 1.0,
  aliasIds: ['claude-haiku-4-5'],
};

/**
 * Authoritative model registry. Keyed by canonical id.
 *
 * Adding a new model = one entry here + run snapshot tests. The resolver
 * picks up new capabilities automatically.
 */
export const MODEL_PROFILES = {
  [OPUS_4_7.canonicalId]: OPUS_4_7,
  [OPUS_4_6.canonicalId]: OPUS_4_6,
  [SONNET_4_6.canonicalId]: SONNET_4_6,
  [HAIKU_4_5.canonicalId]: HAIKU_4_5,
} as const satisfies Record<string, ModelProfile>;

export const ALL_MODEL_PROFILES: readonly ModelProfile[] = [
  OPUS_4_7,
  OPUS_4_6,
  SONNET_4_6,
  HAIKU_4_5,
];

export { OPUS_4_7, OPUS_4_6, SONNET_4_6, HAIKU_4_5 };
