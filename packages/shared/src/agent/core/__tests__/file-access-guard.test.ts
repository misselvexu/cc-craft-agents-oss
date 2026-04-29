/**
 * File-access guard unit tests.
 *
 * Coverage:
 *   - Decision table from docs/analysis/sandbox-isolation-bug.md (32 cases)
 *   - Path normalization edge cases (8 cases)
 *   - Bash command extraction (8 cases)
 *
 * The guard is a pure function — easy to assert as data.
 */

import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import {
  checkCraftAgentAccess,
  extractCraftAgentPathsFromBash,
  normalizeAbsolutePath,
  type SandboxContext,
} from '../file-access-guard.ts';

const HOME = homedir();
const CRAFT = join(HOME, '.craft-agent');

const ctx: SandboxContext = {
  workspaceId: 'wsA',
  workspaceRootPath: join(CRAFT, 'workspaces', 'wsA'),
  sessionId: 'sA',
};

const otherCtx: SandboxContext = {
  workspaceId: 'wsB',
  workspaceRootPath: join(CRAFT, 'workspaces', 'wsB'),
  sessionId: 'sB',
};

// ============================================================
// Decision table — top-level files
// ============================================================

describe('checkCraftAgentAccess — top-level files', () => {
  it('denies read of credentials.enc', () => {
    const r = checkCraftAgentAccess(join(CRAFT, 'credentials.enc'), ctx, 'read');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/sandboxed/);
  });

  it('denies write of credentials.enc', () => {
    const r = checkCraftAgentAccess(join(CRAFT, 'credentials.enc'), ctx, 'write');
    expect(r.allowed).toBe(false);
  });

  it('denies read of config.json', () => {
    const r = checkCraftAgentAccess(join(CRAFT, 'config.json'), ctx, 'read');
    expect(r.allowed).toBe(false);
  });

  it('denies write of config.json', () => {
    const r = checkCraftAgentAccess(join(CRAFT, 'config.json'), ctx, 'write');
    expect(r.allowed).toBe(false);
  });

  it('denies read of preferences.json', () => {
    expect(checkCraftAgentAccess(join(CRAFT, 'preferences.json'), ctx, 'read').allowed).toBe(false);
  });

  it('denies read of theme.json', () => {
    expect(checkCraftAgentAccess(join(CRAFT, 'theme.json'), ctx, 'read').allowed).toBe(false);
  });

  it('denies access to bare ~/.craft-agent/ root', () => {
    expect(checkCraftAgentAccess(CRAFT, ctx, 'read').allowed).toBe(false);
    expect(checkCraftAgentAccess(CRAFT, ctx, 'list').allowed).toBe(false);
  });
});

// ============================================================
// Decision table — workspace metadata
// ============================================================

describe('checkCraftAgentAccess — workspace metadata', () => {
  it('denies workspaces tree listing', () => {
    expect(checkCraftAgentAccess(join(CRAFT, 'workspaces'), ctx, 'list').allowed).toBe(false);
  });

  it('denies cross-workspace access', () => {
    const r = checkCraftAgentAccess(
      join(CRAFT, 'workspaces', 'wsB', 'config.json'),
      ctx,
      'read',
    );
    expect(r.allowed).toBe(false);
    expect(r.debug).toMatch(/cross-workspace/);
  });

  it('denies current workspace metadata listing', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'workspaces', 'wsA'), ctx, 'list').allowed,
    ).toBe(false);
  });

  it('denies current workspace config.json', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'workspaces', 'wsA', 'config.json'), ctx, 'read').allowed,
    ).toBe(false);
  });

  it('denies current workspace automations.json', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'workspaces', 'wsA', 'automations.json'), ctx, 'read')
        .allowed,
    ).toBe(false);
  });

  it('denies current workspace permissions.json', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'workspaces', 'wsA', 'permissions.json'), ctx, 'read')
        .allowed,
    ).toBe(false);
  });

  it('denies current workspace sources/**', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sources', 'github', 'config.json'),
        ctx,
        'read',
      ).allowed,
    ).toBe(false);
  });
});

// ============================================================
// Decision table — skills (read-allow, write-deny)
// ============================================================

describe('checkCraftAgentAccess — skills', () => {
  it('allows read of current workspace skills', () => {
    const r = checkCraftAgentAccess(
      join(CRAFT, 'workspaces', 'wsA', 'skills', 'myskill.md'),
      ctx,
      'read',
    );
    expect(r.allowed).toBe(true);
  });

  it('denies write of current workspace skills', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'skills', 'myskill.md'),
        ctx,
        'write',
      ).allowed,
    ).toBe(false);
  });

  it('denies cross-workspace skills (still cross-workspace boundary)', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsB', 'skills', 'evil.md'),
        ctx,
        'read',
      ).allowed,
    ).toBe(false);
  });
});

// ============================================================
// Decision table — sessions
// ============================================================

describe('checkCraftAgentAccess — sessions', () => {
  it('denies sessions listing in current workspace', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'workspaces', 'wsA', 'sessions'), ctx, 'list').allowed,
    ).toBe(false);
  });

  it('denies cross-session messages.jsonl in same workspace', () => {
    const r = checkCraftAgentAccess(
      join(CRAFT, 'workspaces', 'wsA', 'sessions', 'OTHER', 'messages.jsonl'),
      ctx,
      'read',
    );
    expect(r.allowed).toBe(false);
    expect(r.debug).toMatch(/cross-session/);
  });

  it('denies own session messages.jsonl (force get_session_info)', () => {
    const r = checkCraftAgentAccess(
      join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'messages.jsonl'),
      ctx,
      'read',
    );
    expect(r.allowed).toBe(false);
    expect(r.debug).toMatch(/get_session_info/);
  });

  it('denies own session config.json', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'config.json'),
        ctx,
        'read',
      ).allowed,
    ).toBe(false);
  });

  it('denies own session bare directory listing', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA'),
        ctx,
        'list',
      ).allowed,
    ).toBe(false);
  });

  it('allows read in own session plans/', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'plans', 'task.md'),
        ctx,
        'read',
      ).allowed,
    ).toBe(true);
  });

  it('allows write in own session plans/', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'plans', 'task.md'),
        ctx,
        'write',
      ).allowed,
    ).toBe(true);
  });

  it('allows read in own session data/', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'data', 'cache.json'),
        ctx,
        'read',
      ).allowed,
    ).toBe(true);
  });

  it('denies unknown subdir under own session (default deny)', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'something-new'),
        ctx,
        'read',
      ).allowed,
    ).toBe(false);
  });
});

// ============================================================
// Decision table — public bundled assets
// ============================================================

describe('checkCraftAgentAccess — public bundled assets', () => {
  it('allows read of docs/', () => {
    expect(checkCraftAgentAccess(join(CRAFT, 'docs', 'cli.md'), ctx, 'read').allowed).toBe(true);
  });

  it('denies write of docs/', () => {
    expect(checkCraftAgentAccess(join(CRAFT, 'docs', 'cli.md'), ctx, 'write').allowed).toBe(false);
  });

  it('allows read of themes/', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'themes', 'dracula', 'theme.json'), ctx, 'read').allowed,
    ).toBe(true);
  });

  it('denies write of themes/', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'themes', 'dracula', 'theme.json'), ctx, 'write').allowed,
    ).toBe(false);
  });

  it('allows read of permissions/default.json', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'permissions', 'default.json'), ctx, 'read').allowed,
    ).toBe(true);
  });

  it('allows read of tool-icons/', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'tool-icons', 'index.json'), ctx, 'read').allowed,
    ).toBe(true);
  });
});

// ============================================================
// Out of scope — paths outside ~/.craft-agent/
// ============================================================

describe('checkCraftAgentAccess — outside ~/.craft-agent/ (allow)', () => {
  it('allows project files', () => {
    expect(
      checkCraftAgentAccess('/Users/me/projects/foo/x.ts', ctx, 'read').allowed,
    ).toBe(true);
  });

  it('allows /tmp', () => {
    expect(checkCraftAgentAccess('/tmp/x.txt', ctx, 'write').allowed).toBe(true);
  });

  it('allows home dir directly (not in .craft-agent/)', () => {
    expect(checkCraftAgentAccess(join(HOME, '.bashrc'), ctx, 'read').allowed).toBe(true);
  });

  it('allows path that prefixes .craft-agent/ but is a sibling', () => {
    // /Users/me/.craft-agent-archive/x — not the protected dir
    expect(
      checkCraftAgentAccess(join(HOME, '.craft-agent-archive', 'x.json'), ctx, 'read').allowed,
    ).toBe(true);
  });
});

// ============================================================
// Default deny for everything else inside .craft-agent/
// ============================================================

describe('checkCraftAgentAccess — default deny inside .craft-agent/', () => {
  it('denies unmapped top-level subdir', () => {
    expect(
      checkCraftAgentAccess(join(CRAFT, 'something-future', 'x.json'), ctx, 'read').allowed,
    ).toBe(false);
  });

  it('denies workspaces unknown subdir', () => {
    expect(
      checkCraftAgentAccess(
        join(CRAFT, 'workspaces', 'wsA', 'unknown', 'x.json'),
        ctx,
        'read',
      ).allowed,
    ).toBe(false);
  });

  it('always-allowed reason field is undefined for ALLOW', () => {
    const r = checkCraftAgentAccess('/tmp/x.txt', ctx, 'read');
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('always-deny reason field carries the canonical message', () => {
    const r = checkCraftAgentAccess(join(CRAFT, 'config.json'), ctx, 'read');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/sandboxed/);
    expect(r.reason).toMatch(/get_session_info/);
  });
});

// ============================================================
// Path normalization
// ============================================================

describe('normalizeAbsolutePath', () => {
  it('expands ~ to home dir', () => {
    expect(normalizeAbsolutePath('~/x.txt', '/tmp')).toBe(join(HOME, 'x.txt'));
  });

  it('expands $HOME to home dir', () => {
    expect(normalizeAbsolutePath('$HOME/x.txt', '/tmp')).toBe(join(HOME, 'x.txt'));
  });

  it('treats bare ~ as home dir', () => {
    expect(normalizeAbsolutePath('~', '/tmp')).toBe(HOME);
  });

  it('treats bare $HOME as home dir', () => {
    expect(normalizeAbsolutePath('$HOME', '/tmp')).toBe(HOME);
  });

  it('resolves relative paths against cwd', () => {
    expect(normalizeAbsolutePath('./foo.ts', '/Users/me/p')).toBe('/Users/me/p/foo.ts');
  });

  it('resolves ../ navigation', () => {
    expect(normalizeAbsolutePath('../bar.ts', '/Users/me/p/sub')).toBe('/Users/me/p/bar.ts');
  });

  it('strips trailing separator (but keeps root)', () => {
    expect(normalizeAbsolutePath('/Users/me/p/', '/tmp')).toBe('/Users/me/p');
    // root is left alone — different OS conventions, just verify it doesn't crash
    const root = sep === '/' ? '/' : 'C:\\';
    expect(normalizeAbsolutePath(root, '/tmp')).toBe(root);
  });

  it('handles already-absolute paths', () => {
    expect(normalizeAbsolutePath('/usr/local/bin', '/tmp')).toBe('/usr/local/bin');
  });
});

// ============================================================
// Case-insensitive matching (defense vs. case-variant evasion on macOS/NTFS)
// ============================================================

describe('checkCraftAgentAccess — case-insensitive matching', () => {
  it('denies an upper-case variant of config.json', () => {
    // Simulate a macOS HFS+ case-insensitive filesystem evasion attempt
    const upperPath = join(HOME, '.CRAFT-AGENT', 'CONFIG.JSON');
    expect(checkCraftAgentAccess(upperPath, ctx, 'read').allowed).toBe(false);
  });

  it('denies cross-workspace with a case-variant workspace id', () => {
    // ctx.workspaceId is "wsA"; attacker uses "WSB"
    const r = checkCraftAgentAccess(
      join(CRAFT, 'workspaces', 'WSB', 'config.json'),
      ctx,
      'read',
    );
    expect(r.allowed).toBe(false);
  });
});

describe('checkCraftAgentAccess — cross-user .craft-agent fallback', () => {
  it('denies a path under another user\'s .craft-agent (Bash literal)', () => {
    const r = checkCraftAgentAccess(
      '/Users/someone-else/.craft-agent/config.json',
      ctx,
      'read',
    );
    expect(r.allowed).toBe(false);
    expect(r.debug).toMatch(/cross-user/);
  });

  it('denies bare /Users/x/.craft-agent (no trailing /)', () => {
    expect(checkCraftAgentAccess('/Users/foo/.craft-agent', ctx, 'list').allowed).toBe(false);
  });

  it('still allows nested project paths that happen to contain .craft-agent (no fragment)', () => {
    // Edge case: the regex matches "/.craft-agent/" as a fragment, so a path
    // like "/projects/dot-craft-agent" without a leading slash on the
    // .craft-agent segment is allowed.
    expect(
      checkCraftAgentAccess('/Users/me/projects/dot-craft-agent/foo.txt', ctx, 'read').allowed,
    ).toBe(true);
  });

  it('denies a project layout that DOES contain a .craft-agent subdir (acceptable false-positive)', () => {
    // Documented acceptable false-positive: a literal /.craft-agent/ subdir
    // anywhere is treated as sandboxed. Extremely unusual layout.
    expect(
      checkCraftAgentAccess('/Users/me/projects/foo/.craft-agent/x.txt', ctx, 'read').allowed,
    ).toBe(false);
  });
});

// ============================================================
// Bash command extraction
// ============================================================

describe('extractCraftAgentPathsFromBash', () => {
  it('extracts ~ form', () => {
    expect(extractCraftAgentPathsFromBash('cat ~/.craft-agent/config.json')).toEqual([
      '~/.craft-agent/config.json',
    ]);
  });

  it('extracts /Users/<user>/ form', () => {
    expect(
      extractCraftAgentPathsFromBash('grep token /Users/me/.craft-agent/credentials.enc'),
    ).toEqual(['/Users/me/.craft-agent/credentials.enc']);
  });

  it('extracts $HOME form, stops at | shell metacharacter', () => {
    expect(
      extractCraftAgentPathsFromBash('cat $HOME/.craft-agent/config.json | grep aihub'),
    ).toEqual(['$HOME/.craft-agent/config.json']);
  });

  it('extracts /home/<user>/ form (Linux)', () => {
    expect(
      extractCraftAgentPathsFromBash('ls /home/x/.craft-agent/workspaces/'),
    ).toEqual(['/home/x/.craft-agent/workspaces/']);
  });

  it('extracts trailing-slash bare path', () => {
    expect(extractCraftAgentPathsFromBash('ls ~/.craft-agent/')).toEqual([
      '~/.craft-agent/',
    ]);
  });

  it('extracts multiple paths in a single command', () => {
    expect(
      extractCraftAgentPathsFromBash(
        'cat /Users/me/.craft-agent/config.json /Users/you/.craft-agent/config.json',
      ),
    ).toEqual([
      '/Users/me/.craft-agent/config.json',
      '/Users/you/.craft-agent/config.json',
    ]);
  });

  it('still extracts paths inside double-quoted strings (conservative)', () => {
    // We are conservative: extracting from inside quotes is fine because the
    // intent of an attacker who quotes the path is still to reach the file.
    // Stops at the closing quote (" is in the exclusion class).
    expect(
      extractCraftAgentPathsFromBash('echo "I will not access ~/.craft-agent/"'),
    ).toEqual(['~/.craft-agent/']);
  });

  it('ignores unrelated paths', () => {
    expect(extractCraftAgentPathsFromBash('ls /Users/me/projects')).toEqual([]);
  });

  it('returns empty array for command with no paths', () => {
    expect(extractCraftAgentPathsFromBash('echo hello')).toEqual([]);
  });

  it('dedupes repeated occurrences', () => {
    expect(
      extractCraftAgentPathsFromBash(
        'cat ~/.craft-agent/config.json && cat ~/.craft-agent/config.json',
      ),
    ).toEqual(['~/.craft-agent/config.json']);
  });

  it('does NOT extract dynamic constructions (acceptable false-negative)', () => {
    expect(
      extractCraftAgentPathsFromBash('cat $(echo /Users/me/.cra)$(echo ft-agent/x.json)'),
    ).toEqual([]);
  });
});

// ============================================================
// Sanity: otherCtx (workspaceId='wsB', sessionId='sB') flips access
// ============================================================

describe('context-specific access flipping', () => {
  it('same path: allowed for ctx, denied for otherCtx (cross-workspace)', () => {
    const path = join(CRAFT, 'workspaces', 'wsA', 'sessions', 'sA', 'plans', 'x.md');
    expect(checkCraftAgentAccess(path, ctx, 'read').allowed).toBe(true);
    expect(checkCraftAgentAccess(path, otherCtx, 'read').allowed).toBe(false);
  });
});
