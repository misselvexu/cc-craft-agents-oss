import { describe, expect, it } from 'bun:test'
import {
  resolveClaudeThinkingOptions,
  shouldStripSamplingParams,
  getRecommendedMaxTokens,
} from '../claude-agent.ts'
import { getThinkingTokens } from '../thinking-levels.ts'

describe('resolveClaudeThinkingOptions', () => {
  it('uses adaptive thinking with display: summarized for true Anthropic backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'medium',
      model: 'claude-opus-4-7',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'medium',
    })
  })

  it('uses token budgets for Haiku on true Anthropic backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 6_000,
    })
  })

  it('uses correct max budget for Haiku', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'max',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 8_000,
    })
  })

  it('disables thinking for Haiku when level is off', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'off',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 0,
    })
  })

  it('disables thinking entirely when level is off on adaptive backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'off',
      model: 'claude-sonnet-4-6',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'disabled' },
    })
  })

  it('passes xhigh as effort on adaptive backends (Opus 4.7+)', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'xhigh',
      model: 'claude-opus-4-7',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'xhigh',
    })
  })

  it('always sets display: summarized on adaptive — non-Opus-4.7 Claude models too', () => {
    // Sonnet 4.6 and Opus 4.6 default to display=summarized server-side, but
    // we set it explicitly to keep behaviour consistent and shield against
    // future API default flips.
    for (const model of ['claude-sonnet-4-6', 'claude-opus-4-6']) {
      const result = resolveClaudeThinkingOptions({
        thinkingLevel: 'high',
        model,
        providerType: 'anthropic',
        minimizeThinking: false,
      })
      expect(result).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'high',
      })
    }
  })

  it('uses xhigh token budget on Haiku (non-adaptive)', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'xhigh',
      model: 'claude-haiku-4-5-20251001',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: 7_000,
    })
  })
})

describe('getThinkingTokens', () => {
  it('returns the default (non-haiku) xhigh budget', () => {
    // Any non-haiku model id — provider routing happens elsewhere.
    expect(getThinkingTokens('xhigh', 'claude-sonnet-4-6')).toBe(26_000)
  })

  it('returns the haiku xhigh budget', () => {
    expect(getThinkingTokens('xhigh', 'claude-haiku-4-5-20251001')).toBe(7_000)
  })
})

describe('shouldStripSamplingParams', () => {
  it('strips sampling params on Opus 4.7', () => {
    expect(shouldStripSamplingParams('claude-opus-4-7')).toBe(true)
  })

  it('strips sampling params on Mythos Preview', () => {
    expect(shouldStripSamplingParams('claude-mythos-preview')).toBe(true)
  })

  it('strips sampling params on a dated Opus 4.7 release tag', () => {
    expect(shouldStripSamplingParams('claude-opus-4-7-20260315')).toBe(true)
  })

  it('keeps sampling params on Opus 4.6', () => {
    expect(shouldStripSamplingParams('claude-opus-4-6')).toBe(false)
  })

  it('keeps sampling params on Sonnet 4.6', () => {
    expect(shouldStripSamplingParams('claude-sonnet-4-6')).toBe(false)
  })

  it('keeps sampling params on Haiku 4.5', () => {
    expect(shouldStripSamplingParams('claude-haiku-4-5-20251001')).toBe(false)
  })

  it('keeps sampling params on non-Claude models', () => {
    expect(shouldStripSamplingParams('gpt-5.3-codex')).toBe(false)
    expect(shouldStripSamplingParams('gemini-2.5-pro')).toBe(false)
  })
})

describe('getRecommendedMaxTokens', () => {
  it('returns 64000 for Opus 4.7 with xhigh effort', () => {
    expect(getRecommendedMaxTokens('claude-opus-4-7', 'xhigh')).toBe(64_000)
  })

  it('returns 64000 for Opus 4.7 with max effort', () => {
    expect(getRecommendedMaxTokens('claude-opus-4-7', 'max')).toBe(64_000)
  })

  it('returns 64000 for Mythos Preview at xhigh', () => {
    expect(getRecommendedMaxTokens('claude-mythos-preview', 'xhigh')).toBe(64_000)
  })

  it('returns undefined for Opus 4.7 at low/medium/high (SDK default suffices)', () => {
    expect(getRecommendedMaxTokens('claude-opus-4-7', 'low')).toBeUndefined()
    expect(getRecommendedMaxTokens('claude-opus-4-7', 'medium')).toBeUndefined()
    expect(getRecommendedMaxTokens('claude-opus-4-7', 'high')).toBeUndefined()
  })

  it('returns undefined for Opus 4.7 with no effort (thinking off)', () => {
    expect(getRecommendedMaxTokens('claude-opus-4-7', undefined)).toBeUndefined()
  })

  it('returns undefined for older Claude models even at xhigh/max', () => {
    expect(getRecommendedMaxTokens('claude-opus-4-6', 'max')).toBeUndefined()
    expect(getRecommendedMaxTokens('claude-sonnet-4-6', 'xhigh')).toBeUndefined()
    expect(getRecommendedMaxTokens('claude-haiku-4-5-20251001', 'max')).toBeUndefined()
  })

  it('returns undefined for non-Claude models', () => {
    expect(getRecommendedMaxTokens('gpt-5.3-codex', 'high')).toBeUndefined()
    expect(getRecommendedMaxTokens('gemini-2.5-pro', 'max')).toBeUndefined()
  })
})
