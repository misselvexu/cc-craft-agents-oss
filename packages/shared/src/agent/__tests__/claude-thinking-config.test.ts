/**
 * Legacy thinking-levels token-budget test surface.
 *
 * The original tests in this file covered three interim helpers that have
 * since been removed and replaced by the capability resolver
 * (packages/shared/src/agent/profiles/resolver.ts). Those tests now live in
 * packages/shared/src/agent/profiles/__tests__/resolver.test.ts.
 *
 * What remains here is the standalone test for `getThinkingTokens`, which
 * is still exported from thinking-levels.ts and used by the resolver's
 * enabled-budget branch indirectly.
 */

import { describe, expect, it } from 'bun:test';
import { getThinkingTokens } from '../thinking-levels.ts';

describe('getThinkingTokens', () => {
  it('returns the default (non-haiku) xhigh budget', () => {
    expect(getThinkingTokens('xhigh', 'claude-sonnet-4-6')).toBe(26_000);
  });

  it('returns the haiku xhigh budget', () => {
    expect(getThinkingTokens('xhigh', 'claude-haiku-4-5-20251001')).toBe(7_000);
  });
});
