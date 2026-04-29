/**
 * Capability Resolver tests.
 *
 * Strategy: focused invariant assertions for the cases that matter
 * (the bugs the architecture is supposed to prevent), plus a snapshot
 * matrix for behavioural regression detection.
 *
 * The invariants encode "this MUST hold no matter what other code
 * changes". The snapshots catch any unintended diff in the matrix.
 */

import { describe, expect, it } from 'bun:test';
import { resolveRequestParams, intersectCapabilities } from '../resolver.ts';
import { MODEL_PROFILES } from '../model-profiles.ts';
import { PROVIDER_PROFILES } from '../provider-profiles.ts';
import type { UserIntent } from '../types.ts';

const baseIntent: UserIntent = { thinkingLevel: 'medium' };

// ============================================================
// Invariants — Opus 4.7
// ============================================================

describe('Opus 4.7 + native Anthropic invariants', () => {
  const model = MODEL_PROFILES['claude-opus-4-7']!;
  const provider = PROVIDER_PROFILES['anthropic-native'];

  it('always sets display: summarized on adaptive thinking', () => {
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const { params } = resolveRequestParams({ thinkingLevel: level }, model, provider);
      expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    }
  });

  it('xhigh effort flows through to native Anthropic without downgrade', () => {
    const { params, warnings } = resolveRequestParams(
      { thinkingLevel: 'xhigh' },
      model,
      provider,
    );
    expect(params.effort).toBe('xhigh');
    expect(warnings).toEqual([]);
  });

  it('max effort flows through unchanged', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'max' }, model, provider);
    expect(params.effort).toBe('max');
  });

  it('strips temperature with a warning', () => {
    const { params, warnings } = resolveRequestParams(
      { thinkingLevel: 'medium', temperature: 0.7 },
      model,
      provider,
    );
    expect(params.temperature).toBeUndefined();
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'param-stripped', field: 'temperature', from: 0.7 }),
    );
  });

  it('strips top_p and top_k too', () => {
    const { params, warnings } = resolveRequestParams(
      { thinkingLevel: 'medium', topP: 0.9, topK: 50 },
      model,
      provider,
    );
    expect(params.topP).toBeUndefined();
    expect(params.topK).toBeUndefined();
    expect(warnings.filter((w) => w.kind === 'param-stripped').length).toBe(2);
  });

  it('maxTokens is at least 64k (minMaxTokens floor)', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'xhigh' }, model, provider);
    expect(params.maxTokens).toBeGreaterThanOrEqual(64_000);
  });

  it('user-provided maxTokens above the floor is preserved', () => {
    const { params } = resolveRequestParams(
      { thinkingLevel: 'xhigh', maxTokens: 100_000 },
      model,
      provider,
    );
    expect(params.maxTokens).toBe(100_000);
  });

  it('user-provided maxTokens below the floor is raised to floor', () => {
    const { params } = resolveRequestParams(
      { thinkingLevel: 'xhigh', maxTokens: 8_000 },
      model,
      provider,
    );
    expect(params.maxTokens).toBe(64_000);
  });

  it('off thinkingLevel maps to thinking: disabled', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'off' }, model, provider);
    expect(params.thinking).toEqual({ type: 'disabled' });
  });

  it('minimizeThinking forces thinking off', () => {
    const { params } = resolveRequestParams(
      { thinkingLevel: 'xhigh', minimizeThinking: true },
      model,
      provider,
    );
    expect(params.thinking).toEqual({ type: 'disabled' });
  });

  it('1M context applies suffix and beta header by default', () => {
    const { params, headers } = resolveRequestParams(baseIntent, model, provider);
    expect(params.model).toBe('claude-opus-4-7[1m]');
    expect(headers['anthropic-beta']).toContain('context-1m-2025-08-07');
  });

  it('enable1MContext: false drops both suffix and beta header', () => {
    const { params, headers } = resolveRequestParams(
      { ...baseIntent, enable1MContext: false },
      model,
      provider,
    );
    expect(params.model).toBe('claude-opus-4-7');
    expect(headers['anthropic-beta'] || '').not.toContain('context-1m');
  });
});

// ============================================================
// Invariants — Opus 4.7 via OpenRouter (Bug B)
// ============================================================

describe('Opus 4.7 via OpenRouter (third-party gateway)', () => {
  const model = MODEL_PROFILES['claude-opus-4-7']!;
  const provider = PROVIDER_PROFILES['pi-openrouter'];

  it('still sets adaptive thinking with display', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'xhigh' }, model, provider);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('does NOT include the effort field (OpenRouter strips it)', () => {
    const { params, warnings } = resolveRequestParams(
      { thinkingLevel: 'xhigh' },
      model,
      provider,
    );
    expect(params.effort).toBeUndefined();
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'param-stripped', field: 'effort' }),
    );
  });

  it('still strips sampling params (model property, not provider)', () => {
    const { params } = resolveRequestParams(
      { thinkingLevel: 'medium', temperature: 0.5 },
      model,
      provider,
    );
    expect(params.temperature).toBeUndefined();
  });
});

// ============================================================
// Invariants — Opus 4.6 (effort downgrade)
// ============================================================

describe('Opus 4.6 — xhigh requested', () => {
  const model = MODEL_PROFILES['claude-opus-4-6']!;
  const provider = PROVIDER_PROFILES['anthropic-native'];

  it('xhigh downgrades to high (4.6 does not support xhigh)', () => {
    const { params, warnings } = resolveRequestParams(
      { thinkingLevel: 'xhigh' },
      model,
      provider,
    );
    expect(params.effort).toBe('high');
    expect(warnings).toContainEqual(
      expect.objectContaining({
        kind: 'effort-downgraded',
        from: 'xhigh',
        to: 'high',
      }),
    );
  });

  it('max effort still flows through (4.6 supports max)', () => {
    const { params, warnings } = resolveRequestParams({ thinkingLevel: 'max' }, model, provider);
    expect(params.effort).toBe('max');
    expect(warnings.filter((w) => w.kind === 'effort-downgraded')).toEqual([]);
  });

  it('temperature is preserved (4.6 allows sampling params)', () => {
    const { params } = resolveRequestParams(
      { thinkingLevel: 'medium', temperature: 0.7 },
      model,
      provider,
    );
    expect(params.temperature).toBe(0.7);
  });
});

// ============================================================
// Invariants — Sonnet 4.6
// ============================================================

describe('Sonnet 4.6 — xhigh requested', () => {
  const model = MODEL_PROFILES['claude-sonnet-4-6']!;
  const provider = PROVIDER_PROFILES['anthropic-native'];

  it('xhigh downgrades to high', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'xhigh' }, model, provider);
    expect(params.effort).toBe('high');
  });

  it('does not opt into 1M context (Sonnet does not have 1M)', () => {
    const { params, headers } = resolveRequestParams(
      { thinkingLevel: 'medium', enable1MContext: true },
      model,
      provider,
    );
    expect(params.model).toBe('claude-sonnet-4-6');
    expect(headers['anthropic-beta']).toBeUndefined();
  });
});

// ============================================================
// Invariants — Haiku (enabled-budget thinking)
// ============================================================

describe('Haiku 4.5 — enabled-budget thinking', () => {
  const model = MODEL_PROFILES['claude-haiku-4-5-20251001']!;
  const provider = PROVIDER_PROFILES['anthropic-native'];

  it('uses thinking.enabled with budgetTokens, not adaptive', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'medium' }, model, provider);
    expect(params.thinking).toMatchObject({ type: 'enabled' });
    expect(params.effort).toBeUndefined();
  });

  it('off thinkingLevel maps to budget=0 (still enabled shape)', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'off' }, model, provider);
    expect(params.thinking).toEqual({ type: 'enabled', budgetTokens: 0 });
  });

  it('max thinkingLevel hits the model max budget (8000)', () => {
    const { params } = resolveRequestParams({ thinkingLevel: 'max' }, model, provider);
    expect(params.thinking).toEqual({ type: 'enabled', budgetTokens: 8_000 });
  });
});

// ============================================================
// Invariants — non-Anthropic providers
// ============================================================

describe('Non-thinking provider (e.g. pi-openai-apikey routing a non-thinking model)', () => {
  // Use Opus 4.7 via OpenAI-API path is wrong in practice (OpenAI doesn't host Claude),
  // but it exercises the "provider strips thinking entirely" path. Better test:
  // Haiku via Codex path (won't really happen but tests the code path).
  const model = MODEL_PROFILES['claude-haiku-4-5-20251001']!;
  const provider = PROVIDER_PROFILES['pi-openai-apikey'];

  it('drops thinking entirely with a warning when provider does not forward', () => {
    const { params, warnings } = resolveRequestParams({ thinkingLevel: 'medium' }, model, provider);
    expect(params.thinking).toBeUndefined();
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'thinking-disabled' }),
    );
  });
});

// ============================================================
// intersectCapabilities — direct
// ============================================================

describe('intersectCapabilities', () => {
  it('keeps full adaptive on native Anthropic', () => {
    const eff = intersectCapabilities(
      MODEL_PROFILES['claude-opus-4-7']!,
      PROVIDER_PROFILES['anthropic-native'],
    );
    expect(eff.thinking.kind).toBe('adaptive');
    if (eff.thinking.kind === 'adaptive') {
      expect(eff.thinking.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    }
  });

  it('empties effort levels (signal: stripped) when provider does not forward effort', () => {
    const eff = intersectCapabilities(
      MODEL_PROFILES['claude-opus-4-7']!,
      PROVIDER_PROFILES['pi-openrouter'],
    );
    expect(eff.thinking.kind).toBe('adaptive');
    if (eff.thinking.kind === 'adaptive') {
      expect(eff.thinking.effortLevels).toEqual([]);
    }
  });

  it('collapses thinking to none when provider does not forward thinking', () => {
    const eff = intersectCapabilities(
      MODEL_PROFILES['claude-opus-4-7']!,
      PROVIDER_PROFILES['pi-openai-apikey'],
    );
    expect(eff.thinking.kind).toBe('none');
  });
});

// ============================================================
// Snapshot matrix — behavioural regression detection
// ============================================================

describe('snapshot matrix', () => {
  const models = [
    MODEL_PROFILES['claude-opus-4-7']!,
    MODEL_PROFILES['claude-opus-4-6']!,
    MODEL_PROFILES['claude-sonnet-4-6']!,
    MODEL_PROFILES['claude-haiku-4-5-20251001']!,
  ];
  const providers = [
    PROVIDER_PROFILES['anthropic-native'],
    PROVIDER_PROFILES['anthropic-oauth'],
    PROVIDER_PROFILES['pi-openrouter'],
    PROVIDER_PROFILES['pi-deepseek'],
    PROVIDER_PROFILES['pi-compat-custom'],
  ];
  const intents: UserIntent[] = [
    { thinkingLevel: 'off' },
    { thinkingLevel: 'medium' },
    { thinkingLevel: 'xhigh' },
    { thinkingLevel: 'max', temperature: 0.7 },
  ];

  it('full matrix produces stable shapes', () => {
    const matrix: Record<string, unknown> = {};
    for (const m of models) {
      for (const p of providers) {
        for (const intent of intents) {
          const key = `${m.canonicalId} | ${p.id} | thinking=${intent.thinkingLevel}${intent.temperature !== undefined ? ` t=${intent.temperature}` : ''}`;
          matrix[key] = resolveRequestParams(intent, m, p);
        }
      }
    }
    expect(matrix).toMatchSnapshot();
  });
});
