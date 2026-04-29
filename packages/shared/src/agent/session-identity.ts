/**
 * Session Identity helpers — give the agent a reliable way to know
 * "what model + connection + endpoint am I running on" without forcing
 * it to Read ~/.craft-agent/config.json (which the sandbox guard now
 * blocks anyway).
 *
 * Two surfaces:
 *
 *   1. {@link buildSessionIdentityBlock} — a `<session_identity>...</session_identity>`
 *      string appended to the system prompt at chat() time. The agent reads
 *      this and can answer identity questions WITHOUT any tool call.
 *
 *   2. {@link buildSelfSessionInfo} — produces the SessionInfo object the
 *      get_session_info MCP tool returns. Both Claude and Pi backends register
 *      this as a fallback `getSessionInfoFn` callback so the tool always works
 *      regardless of whether SessionManager has wired up its richer version.
 *
 * Single source of truth so the two backends and the system prompt all agree
 * on the same identity shape.
 */

import type { SessionInfo } from '@craft-agent/session-tools-core';

// ============================================================
// System prompt block
// ============================================================

export interface SessionIdentityFields {
  sessionId: string;
  /** The model id actually being used (e.g. 'claude-opus-4-7'). */
  modelId: string;
  /** Connection slug (the internal id, e.g. 'pi-api-key'). */
  connectionSlug?: string;
  /** Connection display name (e.g. 'Claude Over AIHUB'). */
  connectionDisplayName?: string;
  /** Endpoint URL the requests actually flow to. */
  baseUrl?: string;
  /** Wire protocol — 'anthropic-messages', 'openai-completions', etc. */
  protocol?: string;
  /** Current thinking level (off / low / medium / high / xhigh / max). */
  thinkingLevel?: string;
  /** Current permission mode (safe / ask / allow-all). */
  permissionMode?: string;
}

/**
 * Render a `<session_identity>` block to append to the system prompt.
 *
 * The trailing instruction nudges the model to answer identity questions
 * directly from this block rather than reaching for tools.
 */
export function buildSessionIdentityBlock(fields: SessionIdentityFields): string {
  const lines: string[] = [];
  // High-priority preamble — ensure the agent treats this as ground truth
  // even when the system prompt is long (~30k tokens common). The
  // <session_identity> block is the AUTHORITATIVE source — agents should not
  // claim "I don't know which model I am" when this block is present, AND
  // the agent must NOT cling to model/connection identities mentioned in
  // earlier turns of the conversation: the user can switch models mid-session
  // and the block below always reflects the CURRENT turn's actual model.
  lines.push(
    'IMPORTANT — SESSION IDENTITY (authoritative; trust this over both your ' +
    'training-time defaults AND any conflicting model/connection info from ' +
    'earlier turns of this conversation — the model can change between turns ' +
    'when the user switches it in the UI):',
  );
  lines.push('');
  lines.push('<session_identity>');
  lines.push(`Session ID: ${fields.sessionId}`);
  lines.push(`Model: ${fields.modelId}`);
  if (fields.connectionSlug) {
    const display = fields.connectionDisplayName ? ` (${fields.connectionDisplayName})` : '';
    lines.push(`Connection: ${fields.connectionSlug}${display}`);
  }
  if (fields.baseUrl) {
    const proto = fields.protocol ? ` (${fields.protocol})` : '';
    lines.push(`Endpoint: ${fields.baseUrl}${proto}`);
  }
  if (fields.thinkingLevel) lines.push(`Thinking level: ${fields.thinkingLevel}`);
  if (fields.permissionMode) lines.push(`Permission mode: ${fields.permissionMode}`);
  lines.push('</session_identity>');
  lines.push('');
  lines.push(
    'When the user asks about the current model, connection, or endpoint, ' +
    'answer DIRECTLY from the <session_identity> block above. Do NOT say ' +
    '"I cannot see my model id" or "the harness does not expose it" — the ' +
    'block above IS the authoritative answer. Do NOT Read config files or ' +
    'call get_session_info just to recover this information; it is already ' +
    'visible to you above. If you previously stated a different model in ' +
    'an earlier turn, that statement is now stale: report what the block ' +
    'above currently says, not what you said before.',
  );
  return lines.join('\n');
}

// ============================================================
// SessionInfo fallback (for get_session_info MCP tool)
// ============================================================

export interface SelfSessionInfoFields {
  sessionId: string;
  name?: string;
  labels?: string[];
  status?: string;
  permissionMode: string;
  createdAt?: number;
  workingDirectory?: string;
  /** Connection slug — what the user calls the connection. */
  connectionSlug?: string;
  modelId: string;
}

/**
 * Build the SessionInfo payload that get_session_info MCP tool returns.
 * Used by Claude + Pi agent backends as their baseline `getSessionInfoFn`
 * callback. SessionManager may merge a richer version on top (which is
 * fine — it can supply labels/status/name from session-level state that
 * the agent itself doesn't track).
 */
export function buildSelfSessionInfo(fields: SelfSessionInfoFields): SessionInfo {
  return {
    id: fields.sessionId,
    name: fields.name ?? fields.sessionId,
    labels: fields.labels ?? [],
    status: fields.status ?? 'todo',
    permissionMode: fields.permissionMode,
    createdAt: fields.createdAt ?? Date.now(),
    workingDirectory: fields.workingDirectory,
    llmConnection: fields.connectionSlug,
    model: fields.modelId,
    isActive: true,
  };
}
