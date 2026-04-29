/**
 * File-Access Guard for ~/.craft-agent/ sandbox isolation.
 *
 * Pure functions only — no I/O, no SDK calls. Test as data.
 *
 * Purpose: agents (Claude / Pi) must NOT be able to enumerate the global app
 * config, other sessions' history, other workspaces' data, source
 * configurations, or credentials metadata via Read/Write/Edit/Glob/Grep/Bash.
 * This guard runs as part of the centralized PreToolUse pipeline and is the
 * single source of truth for the (path × operation) → allow/deny decision.
 *
 * The guard is a **baseline** — it does not depend on PermissionMode and is
 * enforced equally in safe / ask / allow-all modes. The mode controls
 * whether writes need user approval; the guard controls whether the path is
 * reachable at all.
 *
 * Decision table is documented in docs/analysis/sandbox-isolation-bug.md
 * (kept in sync with the implementation below).
 */

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// ============================================================
// Types
// ============================================================

export interface SandboxContext {
  /** The current workspace's id (UUID). */
  workspaceId: string;
  /** Absolute path to the workspace root (e.g. ~/.craft-agent/workspaces/{wsId}). */
  workspaceRootPath: string;
  /** The current session's id (e.g. '260429-lively-obsidian'). */
  sessionId: string;
}

export type GuardOperation = 'read' | 'write' | 'list';

export interface GuardDecision {
  allowed: boolean;
  /** User/AI-facing message — kept stable so AI doesn't keep retrying. */
  reason?: string;
  /** Developer-facing message — goes to debug log; carries the matched rule. */
  debug?: string;
}

// ============================================================
// User-facing reason (single canonical message)
// ============================================================

/**
 * Single canonical denial message returned to the agent. Stable across rules
 * so AI quickly learns "this is the boundary, stop poking."
 */
const DENY_REASON =
  "~/.craft-agent/ is the application's private state directory and is " +
  'sandboxed away from agent access. This protects other sessions, ' +
  'connections, and credentials from prompt injection. Use the ' +
  'get_session_info tool to inspect the current session, or ask the user ' +
  'to inspect this directory from the host shell.';

function DENY(debug: string): GuardDecision {
  return { allowed: false, reason: DENY_REASON, debug };
}
function ALLOW(): GuardDecision {
  return { allowed: true };
}

// ============================================================
// Path normalization
// ============================================================

/**
 * Resolve an input path to an absolute path. Handles `~`, `$HOME`,
 * relative paths against cwd, and trailing slashes.
 *
 * Does not resolve symlinks (would require I/O). The guard's prefix
 * matching is case-insensitive to defend against case-variant evasion
 * on case-insensitive filesystems (macOS HFS+, NTFS).
 */
export function normalizeAbsolutePath(input: string, cwd: string): string {
  let path = input;

  // ~ expansion
  if (path === '~') {
    path = homedir();
  } else if (path.startsWith('~/')) {
    path = homedir() + path.slice(1);
  }

  // $HOME expansion
  if (path === '$HOME') {
    path = homedir();
  } else if (path.startsWith('$HOME/')) {
    path = homedir() + path.slice('$HOME'.length);
  }

  // resolve relative against cwd
  path = resolve(cwd, path);

  // strip trailing separator for consistent matching, but preserve root
  if (path.length > 1 && path.endsWith(sep)) path = path.slice(0, -1);

  return path;
}

// ============================================================
// Bash command path extraction (best-effort regex)
// ============================================================

/**
 * Match `~/.craft-agent/...`, `$HOME/.craft-agent/...`,
 * `/Users/<user>/.craft-agent/...`, `/home/<user>/.craft-agent/...`.
 *
 * Path body stops at shell metacharacters that would clearly end an arg.
 * Trailing slash on bare `~/.craft-agent/` is captured.
 */
const CRAFT_AGENT_PATH_RE =
  /(?:~|\$HOME|\/Users\/[^\s/]+|\/home\/[^\s/]+)\/\.craft-agent(?:\/[^\s'"`)|;&]*)?/g;

/**
 * Best-effort extraction of `.craft-agent` paths embedded in a Bash command
 * string. Returns deduped matches in insertion order.
 *
 * **Acceptable false-negatives** (documented in the bug-analysis doc):
 *   - dynamic path construction: `cat $(echo ~/.cra...)`
 *   - file-driven paths: `xargs cat < paths.txt`
 *
 * Justification:
 *   - safe mode bans Bash entirely
 *   - ask mode shows the user the full command
 *   - allow-all mode is explicit user opt-in
 */
export function extractCraftAgentPathsFromBash(command: string): string[] {
  const matches = command.match(CRAFT_AGENT_PATH_RE);
  if (!matches) return [];
  // dedupe while preserving first-seen order
  return Array.from(new Set(matches));
}

// ============================================================
// Core guard
// ============================================================

/**
 * Determine whether an agent may perform `op` on `absolutePath` for the
 * current `ctx`. Paths outside ~/.craft-agent/ are always allowed (the
 * guard's scope is only the app's private directory).
 *
 * The caller is responsible for path normalization first
 * (use {@link normalizeAbsolutePath}).
 */
export function checkCraftAgentAccess(
  absolutePath: string,
  ctx: SandboxContext,
  op: GuardOperation,
): GuardDecision {
  const craftRoot = join(homedir(), '.craft-agent');

  // Case-insensitive prefix match — defends against case-variant evasion on
  // macOS HFS+ and Windows NTFS (both default case-insensitive).
  const pathLower = absolutePath.toLowerCase();
  const rootLower = craftRoot.toLowerCase();

  // Case 1: under the current user's ~/.craft-agent/ — full rule evaluation
  if (pathLower === rootLower || pathLower.startsWith(rootLower + sep)) {
    // fall through to rule evaluation below
  } else {
    // Case 2: not under our home dir, but contains '/.craft-agent/' anywhere
    // (e.g., Bash with hard-coded /Users/<otheruser>/.craft-agent/...). Even
    // if the file isn't actually readable on disk by the current user, the
    // attempt itself is exfiltration intent — block uniformly. The narrow
    // false-positive (a project literally containing a `.craft-agent` dir
    // somewhere) is acceptable; it's an extremely unusual layout.
    const fragment = `${sep}.craft-agent${sep}`;
    const fragmentLower = fragment.toLowerCase();
    const trailingFragment = `${sep}.craft-agent`.toLowerCase();
    if (pathLower.includes(fragmentLower) || pathLower.endsWith(trailingFragment)) {
      return DENY('cross-user .craft-agent access blocked uniformly');
    }
    // Truly out of scope.
    return ALLOW();
  }

  // Bare ~/.craft-agent/ root — agents shouldn't list it.
  if (pathLower === rootLower) {
    return DENY('access to .craft-agent root denied');
  }

  // Compute relative path inside .craft-agent/. Use the lowercased version
  // for matching against rule strings (which are themselves lowercased
  // literals) so case-variant attacks resolve identically.
  const rel = pathLower.slice(rootLower.length + 1);

  // -- Top-level files (deny all) --
  const TOP_DENY = new Set([
    'credentials.enc',
    'config.json',
    'preferences.json',
    'theme.json',
  ]);
  if (TOP_DENY.has(rel)) {
    return DENY(`top-level ${rel} is sandboxed`);
  }

  // -- Public bundled assets (read-only) --
  const PUBLIC_RO_PREFIXES = ['docs/', 'themes/', 'permissions/', 'tool-icons/'];
  for (const prefix of PUBLIC_RO_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) {
      if (op === 'write') {
        return DENY(`public bundled assets under ${prefix} are read-only`);
      }
      return ALLOW();
    }
  }

  // -- Workspaces tree --
  if (rel.startsWith('workspaces/') || rel === 'workspaces') {
    return checkWorkspacesAccess(rel, ctx, op);
  }

  // -- Default deny for everything else inside .craft-agent/ --
  return DENY(`unmapped path under .craft-agent/: ${rel}`);
}

function checkWorkspacesAccess(
  rel: string, // already lowercased; e.g. "workspaces/abc-123/sessions/sid/plans/x.md"
  ctx: SandboxContext,
  op: GuardOperation,
): GuardDecision {
  // workspaces (no subdir) → list of all workspaces, deny
  if (rel === 'workspaces') {
    return DENY('listing of all workspaces is sandboxed');
  }

  const parts = rel.split('/'); // ['workspaces', '{wsId}', ...]
  const wsId = parts[1];
  if (!wsId) {
    return DENY('workspaces tree access denied');
  }

  // Cross-workspace access — denied
  if (wsId !== ctx.workspaceId.toLowerCase()) {
    return DENY('cross-workspace access is sandboxed');
  }

  // workspaces/{currentWs} (no further subdir) → workspace metadata listing
  if (parts.length === 2) {
    return DENY('workspace metadata listing is sandboxed');
  }

  const sub = parts[2];

  // workspaces/{currentWs}/{file or subdir}
  switch (sub) {
    case 'config.json':
    case 'permissions.json':
    case 'automations.json':
    case 'labels.json':
    case 'theme.json':
      return DENY(`workspace ${sub} is sandboxed`);
    case 'sources':
      return DENY('source configurations are sandboxed');
    case 'statuses':
      return DENY('workspace status configuration is sandboxed');
    case 'skills':
      // Skills are user-authored prompts intended for the agent. Read-allow
      // makes them effective; write-deny prevents prompt-injection-modifies-
      // skill attacks.
      if (op === 'write') {
        return DENY('skills are read-only via the agent (edit via UI)');
      }
      return ALLOW();
    case 'sessions':
      return checkSessionAccess(parts.slice(3), ctx, op);
    default:
      // Unknown workspace subdir — default deny.
      return DENY(`unknown workspace subdirectory: ${sub}`);
  }
}

function checkSessionAccess(
  sessionParts: string[], // parts AFTER 'sessions/', e.g. ['{sId}', 'plans', 'x.md']
  ctx: SandboxContext,
  op: GuardOperation,
): GuardDecision {
  // sessions (no subdir) → listing of all sessions in workspace, deny
  if (sessionParts.length === 0) {
    return DENY('listing of sessions is sandboxed');
  }

  const sId = sessionParts[0];
  if (!sId) {
    return DENY('sessions listing is sandboxed');
  }

  // Cross-session — deny (even within same workspace)
  if (sId !== ctx.sessionId.toLowerCase()) {
    return DENY('cross-session access is sandboxed');
  }

  // sessions/{currentS} (no further subdir) → session root listing
  if (sessionParts.length === 1) {
    return DENY('session root listing is sandboxed');
  }

  const sessionSub = sessionParts[1];

  // Session metadata files — deny (force agents to use get_session_info)
  if (
    sessionSub === 'messages.jsonl'
    || sessionSub === 'config.json'
    || sessionSub === 'metadata.json'
    || sessionSub === 'sdk-session.jsonl'
    || sessionSub === 'audit.jsonl'
  ) {
    return DENY(
      `session ${sessionSub} is not readable by the agent — use get_session_info`,
    );
  }

  // plans/ + data/ → allow R/W (current session work product)
  if (sessionSub === 'plans' || sessionSub === 'data') {
    return ALLOW();
  }

  // Anything else under the session — default deny
  return DENY(`unmapped session subdirectory: ${sessionSub}`);
}
