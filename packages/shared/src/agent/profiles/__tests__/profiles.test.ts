/**
 * Profile registry integrity tests.
 *
 * These run before any resolver test — guarantee the data is well-formed.
 * If a future contributor adds a model/provider but forgets a field, this
 * fails fast at the smallest possible test surface.
 */

import { describe, expect, it } from 'bun:test';
import {
  MODEL_PROFILES,
  ALL_MODEL_PROFILES,
  PROVIDER_PROFILES,
  ALL_PROVIDER_PROFILES,
  getModelProfile,
  getProviderProfile,
  inferUnknownModelProfile,
  canonicalizeModelId,
} from '../registry.ts';
import { ANTHROPIC_MODELS } from '../../../config/models.ts';

describe('ModelProfile registry — completeness', () => {
  it('ALL_MODEL_PROFILES matches MODEL_PROFILES values', () => {
    const fromMap = Object.values(MODEL_PROFILES);
    expect(ALL_MODEL_PROFILES.length).toBe(fromMap.length);
    expect(new Set(ALL_MODEL_PROFILES).size).toBe(fromMap.length);
  });

  it('every legacy MODEL_REGISTRY entry has a corresponding ModelProfile', () => {
    // The registry uses canonical ids; legacy MODEL_REGISTRY uses the same.
    for (const m of ANTHROPIC_MODELS) {
      const profile = getModelProfile(m.id);
      expect(profile.canonicalId).toBeTruthy();
      // Either exact match or alias; should not be the inferred unknown profile
      const isInferred = !(profile.canonicalId in MODEL_PROFILES);
      if (isInferred) {
        throw new Error(`Legacy model ${m.id} has no ModelProfile (got inferred fallback)`);
      }
    }
  });

  it('every profile has all required capability fields', () => {
    for (const profile of ALL_MODEL_PROFILES) {
      const c = profile.capabilities;
      expect(c.thinking).toBeDefined();
      expect(c.thinking.kind).toMatch(/^(adaptive|enabled-budget|reasoning-effort|none)$/);
      expect(c.samplingParams).toMatch(/^(allowed|forbidden)$/);
      expect(c.promptCaching).toMatch(/^(cache_control|auto|none)$/);
      expect(typeof c.cacheTtl1h).toBe('boolean');
      expect(typeof c.fastMode).toBe('boolean');
      expect(c.interleavedThinking).toMatch(/^(always-on|opt-in-beta|deprecated|unsupported)$/);
      expect(typeof c.pdfInput).toBe('boolean');
      expect(typeof c.citations).toBe('boolean');
      expect(typeof c.visionInput).toBe('boolean');
      expect(typeof c.audioInput).toBe('boolean');
      expect(typeof c.parallelToolUse).toBe('boolean');
    }
  });

  it('adaptive thinking always declares a non-empty effortLevels list', () => {
    for (const profile of ALL_MODEL_PROFILES) {
      if (profile.capabilities.thinking.kind === 'adaptive') {
        expect(profile.capabilities.thinking.effortLevels.length).toBeGreaterThan(0);
      }
    }
  });

  it('Opus 4.7 is the only model declaring xhigh effort', () => {
    const xhighModels = ALL_MODEL_PROFILES.filter(
      (p) =>
        p.capabilities.thinking.kind === 'adaptive' &&
        p.capabilities.thinking.effortLevels.includes('xhigh'),
    );
    expect(xhighModels.length).toBe(1);
    expect(xhighModels[0]?.canonicalId).toBe('claude-opus-4-7');
  });

  it('Opus 4.7 forbids sampling params', () => {
    expect(MODEL_PROFILES['claude-opus-4-7']!.capabilities.samplingParams).toBe('forbidden');
  });

  it('Opus 4.7 default thinkingDisplay is summarized', () => {
    expect(MODEL_PROFILES['claude-opus-4-7']!.defaults.thinkingDisplay).toBe('summarized');
  });

  it('Opus 4.7 minMaxTokens is at least 64k', () => {
    expect(MODEL_PROFILES['claude-opus-4-7']!.defaults.minMaxTokens).toBeGreaterThanOrEqual(64_000);
  });

  it('Haiku uses enabled-budget thinking, not adaptive', () => {
    expect(MODEL_PROFILES['claude-haiku-4-5-20251001']!.capabilities.thinking.kind).toBe('enabled-budget');
  });
});

describe('ProviderProfile registry — completeness', () => {
  it('ALL_PROVIDER_PROFILES matches PROVIDER_PROFILES non-fallback values', () => {
    // ALL_PROVIDER_PROFILES excludes the 'unknown' fallback
    expect(ALL_PROVIDER_PROFILES.length).toBe(Object.keys(PROVIDER_PROFILES).length - 1);
  });

  it('every provider has all routingCapabilities fields', () => {
    for (const profile of [...ALL_PROVIDER_PROFILES, PROVIDER_PROFILES.unknown]) {
      const r = profile.routingCapabilities;
      expect(r.forwardsThinkingType).toMatch(/^(all|adaptive-only|enabled-only|none)$/);
      expect(typeof r.forwardsEffort).toBe('boolean');
      expect(r.forwardsBetaHeaders).toMatch(/^(all|whitelist|none)$/);
      expect(typeof r.forwardsToolChoice).toBe('boolean');
      expect(r.forwardsCacheControl).toMatch(/^(full|partial|none)$/);
      expect(typeof r.silentlyDowngradesEffort).toBe('boolean');
    }
  });

  it('only native Anthropic providers silently downgrade effort', () => {
    expect(PROVIDER_PROFILES['anthropic-native'].routingCapabilities.silentlyDowngradesEffort).toBe(true);
    expect(PROVIDER_PROFILES['anthropic-oauth'].routingCapabilities.silentlyDowngradesEffort).toBe(true);
    expect(PROVIDER_PROFILES['pi-openrouter'].routingCapabilities.silentlyDowngradesEffort).toBe(false);
  });

  it('OpenRouter does not currently forward Anthropic effort', () => {
    expect(PROVIDER_PROFILES['pi-openrouter'].routingCapabilities.forwardsEffort).toBe(false);
  });
});

describe('canonicalizeModelId', () => {
  it('returns canonical ids unchanged', () => {
    expect(canonicalizeModelId('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(canonicalizeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('resolves aliases to canonical', () => {
    expect(canonicalizeModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5-20251001');
    expect(canonicalizeModelId('claude-mythos-preview')).toBe('claude-opus-4-7');
  });

  it('strips pi/ prefix', () => {
    expect(canonicalizeModelId('pi/claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(canonicalizeModelId('pi/claude-haiku-4-5')).toBe('claude-haiku-4-5-20251001');
  });

  it('handles OpenRouter-style anthropic/* prefix with dotted version', () => {
    expect(canonicalizeModelId('anthropic/claude-opus-4.7')).toBe('claude-opus-4-7');
    expect(canonicalizeModelId('anthropic/claude-sonnet-4.6')).toBe('claude-sonnet-4-6');
  });

  it('handles Bedrock-native ids', () => {
    expect(canonicalizeModelId('us.anthropic.claude-opus-4-7-v1')).toBe('claude-opus-4-7');
    expect(canonicalizeModelId('eu.anthropic.claude-opus-4-7-v1')).toBe('claude-opus-4-7');
    expect(canonicalizeModelId('global.anthropic.claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('returns unknown ids unchanged', () => {
    expect(canonicalizeModelId('mistralai/mistral-large-2')).toBe('mistralai/mistral-large-2');
    expect(canonicalizeModelId('totally-made-up-model-id')).toBe('totally-made-up-model-id');
  });
});

describe('getModelProfile', () => {
  it('returns hand-curated profile for known canonical ids', () => {
    expect(getModelProfile('claude-opus-4-7').canonicalId).toBe('claude-opus-4-7');
  });

  it('returns hand-curated profile for aliases via canonicalization', () => {
    expect(getModelProfile('claude-haiku-4-5').canonicalId).toBe('claude-haiku-4-5-20251001');
  });

  it('returns inferred profile for unknown ids', () => {
    const profile = getModelProfile('mistralai/mistral-large-2');
    expect(profile.canonicalId).toBe('mistralai/mistral-large-2');
    expect(profile.family).toBe('unknown'); // 'mistral' substring gives mistral vendor though
    // Actually 'mistral-large' includes 'mistral', let's just check defaults
    expect(profile.capabilities.thinking.kind).toBe('none');
    expect(profile.capabilities.samplingParams).toBe('allowed');
  });
});

describe('inferUnknownModelProfile', () => {
  it('infers Opus family from substring', () => {
    const p = inferUnknownModelProfile('claude-opus-9-0');
    expect(p.family).toBe('claude-opus');
    expect(p.vendor).toBe('anthropic');
  });

  it('infers GPT codex family', () => {
    const p = inferUnknownModelProfile('gpt-7.0-codex');
    expect(p.family).toBe('gpt-codex');
    expect(p.vendor).toBe('openai');
  });

  it('infers Gemini family', () => {
    const p = inferUnknownModelProfile('gemini-3-flash-preview');
    expect(p.family).toBe('gemini');
    expect(p.vendor).toBe('google');
  });

  it('infers Qwen family', () => {
    const p = inferUnknownModelProfile('qwen/qwen3-coder-plus');
    expect(p.family).toBe('qwen');
    expect(p.vendor).toBe('qwen');
  });

  it('falls back to unknown for truly novel ids', () => {
    const p = inferUnknownModelProfile('totally-novel-xyz');
    expect(p.family).toBe('unknown');
    expect(p.vendor).toBe('unknown');
    expect(p.capabilities.thinking.kind).toBe('none');
    expect(p.capabilities.samplingParams).toBe('allowed');
  });
});

describe('getProviderProfile', () => {
  it('returns explicit profile when providerProfileId given', () => {
    const p = getProviderProfile({ providerProfileId: 'pi-deepseek' });
    expect(p.id).toBe('pi-deepseek');
  });

  it('routes anthropic + native baseUrl + api_key -> anthropic-native', () => {
    const p = getProviderProfile({
      legacyProviderType: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      authType: 'api_key',
    });
    expect(p.id).toBe('anthropic-native');
  });

  it('routes anthropic + native baseUrl + oauth -> anthropic-oauth', () => {
    const p = getProviderProfile({
      legacyProviderType: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      authType: 'oauth',
    });
    expect(p.id).toBe('anthropic-oauth');
  });

  it('routes anthropic + OpenRouter baseUrl -> pi-openrouter (matched by host)', () => {
    const p = getProviderProfile({
      legacyProviderType: 'anthropic',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(p.id).toBe('pi-openrouter');
  });

  it('routes anthropic + unknown baseUrl -> pi-compat-custom', () => {
    const p = getProviderProfile({
      legacyProviderType: 'anthropic',
      baseUrl: 'https://my-self-hosted.example.com/v1',
    });
    expect(p.id).toBe('pi-compat-custom');
  });

  it('routes pi + piAuthProvider -> matching pi-* profile', () => {
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'openai' }).id).toBe('pi-openai-apikey');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'google' }).id).toBe('pi-google-aistudio');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'github-copilot' }).id).toBe('pi-copilot-oauth');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'openai-codex' }).id).toBe('pi-codex-oauth');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'deepseek' }).id).toBe('pi-deepseek');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'kimi-coding' }).id).toBe('pi-kimi');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'zai' }).id).toBe('pi-zai');
    expect(getProviderProfile({ legacyProviderType: 'pi', piAuthProvider: 'minimax' }).id).toBe('pi-minimax');
  });

  it('routes pi_compat -> pi-compat-custom', () => {
    expect(getProviderProfile({ legacyProviderType: 'pi_compat' }).id).toBe('pi-compat-custom');
  });

  it('falls back to unknown when nothing matches', () => {
    expect(getProviderProfile({}).id).toBe('unknown');
  });
});
