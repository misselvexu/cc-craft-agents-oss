# Opus 4.7 Thinking/Reasoning Parameter Bugs — Analysis

**Status:** Active analysis, drives the implementation in branch `feat/opus-4-7-fixes-and-provider-cleanup`.

**Audience:** Contributors touching `packages/shared/src/agent/claude-agent.ts`, `packages/shared/src/agent/thinking-levels.ts`, model/provider routing, or the upcoming `packages/shared/src/agent/profiles/` registry.

This document fixes the institutional knowledge from the April 2026 investigation into why Craft Agents was misbehaving on Claude Opus 4.7, so future contributors don't have to re-derive it.

---

## 1. What changed in Opus 4.7

Opus 4.7 (released Q1 2026) introduced a set of **breaking** changes to the request/response shape that older Claude 4.x clients did not anticipate. The full list:

| Field | Opus 4.6 behavior | Opus 4.7 behavior | Source |
|---|---|---|---|
| `thinking: { type: 'enabled', budget_tokens: N }` | Supported | **400 error** (removed) | [Anthropic migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) |
| Default thinking when field omitted | Possibly adaptive | **Off** — must explicitly set `{ type: 'adaptive' }` | [Adaptive thinking docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) |
| `thinking.display` default | `'summarized'` | **`'omitted'`** — thinking text is empty unless explicitly set | [Extended thinking docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) |
| `effort: 'xhigh'` | **Unsupported** | New, exclusive to Opus 4.7 | [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort) |
| `effort: 'max'` | Supported (4.6) | Supported | [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort) |
| `interleaved-thinking-2025-05-14` beta header | Required to enable | **Deprecated** — adaptive auto-enables interleaved | [Migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) |
| `temperature` / `top_p` / `top_k` non-default values | Accepted | **400 error** | [What's new](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7) |
| Recommended `max_tokens` | 32k typical | **≥ 64k** (esp. with `xhigh`/`max` effort) | [What's new](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7) |
| Tokenizer | Old | **New** — uses 1.0–1.35× tokens for the same text | [What's new](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7) |

The display default flip is particularly nasty — it has [tripped up Anthropic's own Claude Code harness](https://github.com/anthropics/claude-code/issues/49268) and [LiteLLM](https://github.com/BerriAI/litellm/issues/25965), and surfaces as "long pause then a wall of text" rather than visible streaming reasoning.

### Effort level support matrix (canonical reference)

| Model | `low` | `medium` | `high` | `xhigh` | `max` |
|---|---|---|---|---|---|
| Opus 4.7 | ✓ | ✓ | ✓ | ✓ | ✓ |
| Opus 4.6 | ✓ | ✓ | ✓ | — | ✓ |
| Sonnet 4.6 | ✓ | ✓ | ✓ | — | ✓ |
| Opus 4.5 | ✓ | ✓ | ✓ | — | ✓ |
| Haiku 4.5 | uses `thinking.enabled` budget tokens, no effort dial |

The native Anthropic API silently downgrades unsupported `effort` to `high`. Third-party gateways (OpenRouter, Vercel AI Gateway, Ollama) **do not** make this guarantee.

---

## 2. Current bugs in cc-craft-agents-oss

All locations are relative to repo root.

### Bug J — Missing `display: 'summarized'` (Critical)

**Where:** `packages/shared/src/agent/claude-agent.ts:147-152` (the `supportsAdaptiveThinking` branch in `resolveClaudeThinkingOptions`).

```ts
return {
  thinking: { type: 'adaptive' as const },   // ← no display field
  effort,
};
```

**Effect:** On Opus 4.7 the API defaults `display` to `'omitted'`. Thinking blocks still appear in the SSE stream, but `thinking.text` is empty. The renderer's "thinking…" UI gets no streamable content, so users see a long pause before the assistant starts visibly responding.

**Reproduce:**
1. Pick Opus 4.7, set thinking level to `xhigh`.
2. Send a complex prompt that should trigger several seconds of thinking.
3. Observe UI: no thinking summary streams; assistant appears to hang.

**Fix:** Always set `display: 'summarized'` whenever the thinking type is `adaptive`. Models older than Opus 4.7 default to `'summarized'`; explicitly setting it is a no-op there and a fix on 4.7.

---

### Bug L — Sampling params sent to Opus 4.7 (Critical)

**Where:** `packages/shared/src/agent/claude-agent.ts:2664` in `queryLlm()`:

```ts
...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
```

The `call_llm` tool exposes `temperature: z.number().min(0).max(1).optional()` (`packages/shared/src/agent/llm-tool.ts:587-591`). Any user / sub-agent that supplies `temperature` for an Opus 4.7 query will hit a **400 error** ("temperature is not allowed on this model").

**Reproduce:** Invoke `call_llm` from a tool with `model: 'claude-opus-4-7'` and `temperature: 0.7`.

**Fix (interim):** Strip sampling params when target model is Opus 4.7+ family. Schema description should also mention the limitation.

**Fix (proper):** Profile-driven — `ModelProfile.capabilities.samplingParams: 'forbidden' | 'allowed'`.

---

### Bug M — `max_tokens` default may be too low (Critical)

**Where:** Main `chat()` in `packages/shared/src/agent/claude-agent.ts:910-941` does not explicitly set `max_tokens`, leaving the SDK default.

**Effect:** Anthropic recommends `max_tokens ≥ 64k` for Opus 4.7 with `xhigh`/`max` effort. Long agentic loops with the older default trip `stop_reason: 'max_tokens'` mid-task, truncating tool calls and final answers.

**Reproduce:**
1. Opus 4.7 + `xhigh` + an agentic prompt requiring 10+ tool calls.
2. Observe truncated responses or `stop_reason: 'max_tokens'` events.

**Fix:** When `(model is Opus 4.7) && (effort ∈ {xhigh, max})`, set `maxTokens: 64000`. Long-term: drive from `ModelProfile.defaults.minMaxTokens`.

---

### Bug B — `providerType` is dead code (Important)

**Where:** `packages/shared/src/agent/claude-agent.ts:129-157` — `resolveClaudeThinkingOptions` accepts `providerType` and destructures it, but the function body never uses it:

```ts
const { thinkingLevel, model, providerType, minimizeThinking } = args;
//                                ^^^^^^^^^^^^ unused
const isClaude = isClaudeModel(model);
const effort = THINKING_TO_EFFORT[thinkingLevel];
const isHaiku = model.toLowerCase().includes('haiku');
const supportsAdaptiveThinking = isClaude && !isHaiku;   // doesn't consider providerType
```

The comment at `claude-agent.ts:937-940` claims provider-aware behavior:

```ts
// Thinking config is provider-aware:
// - true Anthropic backends use adaptive thinking + effort
// - anthropic_compat/custom endpoints fall back to token budgets
// - non-Claude models disable thinking entirely
```

But the implementation does not enforce this. **Effect:**

- A Claude model routed via OpenRouter / Vercel AI Gateway / Ollama / any custom Claude-compatible endpoint receives `{ thinking: { type: 'adaptive' }, effort: <level> }`.
- Native Anthropic silently downgrades unsupported effort (`xhigh` on non-4.7 models → `high`). Third-party gateways do not.
- OpenRouter currently does **not** forward the `effort` field — so users get an undocumented behavior degradation.

**Real signal:** the connection's `baseUrl`, not `providerType`. `claude-agent.ts:871-876` already reads `activeBaseUrl` and logs it but doesn't pass it down.

**Fix:** Drive the decision from a `ProviderProfile.routingCapabilities.forwardsEffort` field (boolean), with `baseUrl !== undefined && baseUrl !== 'https://api.anthropic.com'` as the trigger for non-native routing.

---

### Bug A — `xhigh`/`max` effort sent to non-4.7 models (Mostly mitigated)

**Where:** Same function, `claude-agent.ts:147-152`. `supportsAdaptiveThinking` is `isClaude && !isHaiku`, so `effort: 'xhigh'` is emitted for any non-Haiku Claude. The native Anthropic API silently downgrades to `high`. **But:**

- Bedrock may not always implement the same downgrade timing.
- All third-party gateways have no such guarantee.
- Client-side downgrade is the safe path: emit only effort levels the model actually supports.

**Fix:** `ModelProfile.capabilities.thinking.effortLevels` lists supported levels per model; resolver picks the highest allowed value ≤ user's request.

---

### Bug N — Default thinking level should be per-model (Product alignment)

**Where:** `packages/shared/src/agent/thinking-levels.ts:63`:

```ts
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
```

**Effect:** Anthropic explicitly recommends `xhigh` as the new default for Claude Code-style coding agents on Opus 4.7. Even the official Claude Code harness automatically upgrades existing users to `xhigh` (see [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)). Craft Agents currently defaults to `medium`, which on 4.7 means "minimal thinking" relative to peer experiences.

**Fix:** Move default into `ModelProfile.defaults.thinkingLevel`. Opus 4.7 → `xhigh`; older Claude → `medium`; non-Claude → `medium` or `off`.

---

### Bug E — Deprecated `maxThinkingTokens` for Haiku (Low impact)

**Where:** `claude-agent.ts:154-156` Haiku branch returns `{ maxThinkingTokens: N }`. The SDK marks this `@deprecated` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1219-1222`); modern form is `{ thinking: { type: 'enabled', budgetTokens: N } }`.

Currently fine for Haiku 4.5 (still accepts the legacy form), but will break the day a Haiku 4.7 ships.

---

### Bug D — Stale comment in `thinking-levels.ts` (Cosmetic)

**Where:** `thinking-levels.ts:14-19`:

```ts
* Provider mappings:
* - Anthropic: adaptive thinking + effort levels (Opus 4.7+).
```

Per Anthropic docs, adaptive thinking is supported from **Opus 4.6+**, not 4.7+. Only `xhigh` is exclusive to 4.7.

---

## 3. Why ProviderProfile / ModelProfile / Resolver?

A patch-only approach (add an `if (model === 'claude-opus-4-7') …` here, a guard there) would fix the immediate symptoms but:

- **Doesn't scale.** Sonnet 4.7, Haiku 4.7, future 5.x, plus every gateway-specific quirk all collide here.
- **Bug B requires architectural awareness.** The fix needs the request building path to know "is this going to native Anthropic or via OpenRouter?", which means propagating that signal — there is no clean way to bolt this on.
- **Capability information is already fragmented:** `MODEL_REGISTRY`, `THINKING_TO_EFFORT`, `TOKEN_BUDGETS.haiku/default`, `BEDROCK_TO_BARE`, `shouldEnableFastMode`, `1m context` model suffix — they all live in different files and answer different sub-questions about model capability. Consolidating gives one place to look.

The data model:

- **`ModelProfile`** describes "what Opus 4.7 can do" (capabilities + recommended defaults), provider-agnostic.
- **`ProviderProfile`** describes "what OpenRouter forwards" (routing capabilities), model-agnostic.
- **`ModelMapping`** is the binding `(canonicalModelId, providerProfileId) → providerSpecificModelId + overrides`.
- **`resolveRequestParams(intent, modelProfile, providerProfile)`** is a pure function: input user intent + profiles, output the SDK call shape + warnings.

Both `ClaudeAgent` and `PiAgent` consume the resolver. The unified network interceptor (`packages/shared/src/unified-network-interceptor.ts`) becomes a "safety net" — it verifies the resolver's decisions against the URL it actually sees and strips anything that snuck through.

This trades upfront effort (writing 4 ModelProfiles + 12 ProviderProfiles + a snapshot test matrix) for ~zero ongoing maintenance: each new model = one profile entry, each new gateway = one profile entry, each new capability = one type field + one resolver branch.

---

## 4. Test matrix design principles

The resolver is pure → everything testable as data → snapshot tests are the right tool.

Matrix dimensions for the snapshot test (`packages/shared/src/agent/profiles/__tests__/resolver.snapshot.test.ts`):

```
models      = [opus-4-7, opus-4-6, sonnet-4-6, haiku-4-5]            (4)
providers   = [anthropic-native, openrouter, bedrock, vercel,
                pi-google, pi-openai, pi-deepseek, pi-kimi,
                pi-zai, pi-minimax, pi-copilot, pi-codex]              (12)
thinking    = [off, low, medium, high, xhigh, max]                    (6)
temperature = [undefined, 0.7]                                         (2)
                                                                      ────
                                                                       576 cases
```

Each snapshot encodes:
- The full SDK params object the agent will send
- The header overrides
- The downgrade warnings (if any)

Snapshot diffs become the canary for capability regressions — any time a profile is touched, snapshot review forces an explicit acknowledgment of behavioral changes.

Property-based / explicit assertions for invariants the snapshot can't catch directly:

- `temperature` is never present when `samplingParams === 'forbidden'`
- `effort` is always `∈ effortLevels` of the resolved capability
- `display: 'summarized'` is always present on `adaptive` thinking
- `maxTokens` is always `≥ defaults.minMaxTokens`
- `model` is always run through `providerProfile.modelIdTransform` if present

---

## 5. Source links (frozen at investigation time)

- [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)
- [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)
- [OpenRouter Claude 4.7 migration guide](https://openrouter.ai/docs/guides/evaluate-and-optimize/model-migrations/claude-4-7)
- [Effort, Thinking, and How Claude Opus 4.7 Changed the Rules — iBuildWith.ai](https://www.ibuildwith.ai/blog/effort-thinking-opus-4-7-changed-the-rules/)
- [Opus 4.7 killed budget_tokens — DEV community](https://dev.to/ji_ai/opus-47-killed-budgettokens-what-changed-and-how-to-migrate-3ian)
- GitHub issues evidencing the `display` regression in other harnesses:
  - [Anthropic's own Claude Code, #49268](https://github.com/anthropics/claude-code/issues/49268)
  - [Anthropic's own Claude Code, #49708](https://github.com/anthropics/claude-code/issues/49708)
  - [LiteLLM, #25965](https://github.com/BerriAI/litellm/issues/25965)
