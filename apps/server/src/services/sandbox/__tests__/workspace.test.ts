import {
  DEFAULT_SANDBOX_MODE,
  deriveSandboxWorkspaceKey,
  formatSandboxWorkspacePrompt,
  formatSandboxWorkspacePromptVariables,
  isSafeSandboxCwd,
  type SandboxWorkspacePromptVariables,
  systemPrompt,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

describe('deriveSandboxWorkspaceKey', () => {
  it('uses the personal key when no workspace is scoped', () => {
    expect(deriveSandboxWorkspaceKey({ userId: 'user_abc' })).toBe('ws-user_abc');
    expect(deriveSandboxWorkspaceKey({ userId: 'user_abc', workspaceId: null })).toBe(
      'ws-user_abc',
    );
  });

  it('shares one key across an organization workspace', () => {
    expect(deriveSandboxWorkspaceKey({ userId: 'user_abc', workspaceId: 'wsp_42' })).toBe(
      'ws-org-wsp_42',
    );
  });

  // The key names a directory on a shared volume and is signed into the claim.
  // Refusing beats sanitizing: `user_a/b` and `user_a-b` would both reduce to
  // `ws-user_a-b`, and a length cap aliases every id sharing a prefix — either
  // way two principals land in ONE directory and read each other's files.
  it('refuses an id that is not already a safe path segment', () => {
    expect(deriveSandboxWorkspaceKey({ userId: '../etc/passwd' })).toBeUndefined();
    expect(deriveSandboxWorkspaceKey({ userId: '$(rm -rf /)' })).toBeUndefined();
    expect(deriveSandboxWorkspaceKey({ userId: 'user a' })).toBeUndefined();
    expect(deriveSandboxWorkspaceKey({ userId: 'évil' })).toBeUndefined();
    expect(deriveSandboxWorkspaceKey({ userId: '' })).toBeUndefined();
    expect(deriveSandboxWorkspaceKey({ userId: 'u', workspaceId: 'wsp/42' })).toBeUndefined();
    // Over the 128-char ceiling the receiving end enforces.
    expect(deriveSandboxWorkspaceKey({ userId: 'x'.repeat(200) })).toBeUndefined();
  });

  // Two ids that differ at all must never produce the same key.
  it('is injective for the id shapes the platform issues', () => {
    const keys = ['user_a_b', 'user_a-b', 'user_ab', 'user_A_B'].map((userId) =>
      deriveSandboxWorkspaceKey({ userId }),
    );

    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Both shapes share one namespace, so `ws-<userId>` with a userId of
  // `org-wsp_42` would address the very directory the workspace `wsp_42` uses.
  it('keeps personal and organization namespaces apart', () => {
    expect(deriveSandboxWorkspaceKey({ userId: 'u', workspaceId: 'wsp_42' })).toBe('ws-org-wsp_42');
    expect(deriveSandboxWorkspaceKey({ userId: 'org-wsp_42' })).toBeUndefined();
  });
});

describe('formatSandboxWorkspacePromptVariables', () => {
  const placeholders = ['{{sandbox_workspace}}', '{{sandbox_session_files}}'];
  const render = (vars: SandboxWorkspacePromptVariables) =>
    placeholders.reduce(
      (acc, key) => acc.replaceAll(key, vars[key.slice(2, -2) as keyof typeof vars]),
      systemPrompt,
    );

  it('defaults to ephemeral', () => {
    expect(DEFAULT_SANDBOX_MODE).toBe('ephemeral');
    expect(formatSandboxWorkspacePromptVariables()).toEqual(
      formatSandboxWorkspacePromptVariables({ mode: 'ephemeral' }),
    );
    expect(formatSandboxWorkspacePrompt()).toBe(
      formatSandboxWorkspacePromptVariables().sandbox_workspace,
    );
  });

  // Persistence is not enabled yet: until an entitlement claim is issued every
  // run renders this branch, so it has to reproduce the pre-placeholder prompt
  // exactly — including the lines surrounding the two spliced sections.
  it('renders the original ephemeral wording, byte for byte', () => {
    const vars = formatSandboxWorkspacePromptVariables();
    const rendered = render(vars);

    for (const key of placeholders) expect(rendered).not.toContain(key);
    expect(rendered).toContain(
      '- Files created here are temporary and session-specific\n- Each conversation topic has its own isolated session\n- Sessions may expire after inactivity; files will be recreated if needed\n- The sandbox has its own isolated file system starting at the root directory\n- Commands will time out',
    );
    expect(rendered).toContain(
      '- If a session expires, it will be automatically recreated\n- Files from previous sessions may not persist\n- The sessionExpiredAndRecreated flag',
    );
  });

  it('describes a persistent workspace without naming a directory', () => {
    const vars = formatSandboxWorkspacePromptVariables({ mode: 'persistent' });
    const rendered = render(vars);

    for (const key of placeholders) expect(rendered).not.toContain(key);
    expect(vars.sandbox_workspace).toContain('persistent workspace');
    // Steers heavy work away from the workspace without naming a scratch
    // directory: where installs land is the platform's business, and a path
    // written here would outlive whatever it decides to do with them.
    expect(vars.sandbox_workspace).toContain('network storage');
    expect(vars.sandbox_workspace).not.toContain('/tmp');
    expect(rendered).not.toContain('temporary and session-specific');
    expect(rendered).not.toContain('Files from previous sessions may not persist');
  });

  it('names the chosen subdirectory and places it under the workspace root', () => {
    const vars = formatSandboxWorkspacePromptVariables({
      cwd: 'projects/atlas',
      mode: 'persistent',
    });

    expect(vars.sandbox_workspace).toContain('`projects/atlas`');
    expect(vars.sandbox_workspace).toContain('workspace root is above you');
    // The generic "pick your own subdirectory" advice is wrong once one is
    // chosen — the model is already in it.
    expect(vars.sandbox_workspace).not.toContain('its own subdirectory');
  });

  it('ignores a subdirectory on an ephemeral run', () => {
    expect(
      formatSandboxWorkspacePromptVariables({ cwd: 'projects/atlas', mode: 'ephemeral' }),
    ).toEqual(formatSandboxWorkspacePromptVariables());
  });

  // The mount root belongs to the execution plane. Spelling an absolute path
  // out here would be a second source of truth that can only drift, and a
  // model that wrote one down would keep using it after the root moved.
  it('never hardcodes a mount path', () => {
    for (const input of [
      { mode: 'persistent' } as const,
      { cwd: 'a/b', mode: 'persistent' } as const,
    ]) {
      const vars = formatSandboxWorkspacePromptVariables(input);
      expect(vars.sandbox_workspace).not.toContain('/mnt/');
      expect(vars.sandbox_workspace).not.toContain('ws-');
      expect(vars.sandbox_session_files).not.toContain('/mnt/');
    }
  });
});

describe('isSafeSandboxCwd', () => {
  it('accepts a relative subdirectory', () => {
    expect(isSafeSandboxCwd('projects/atlas')).toBe(true);
    expect(isSafeSandboxCwd('a')).toBe(true);
    // A space is a legal directory name, not something to tidy away.
    expect(isSafeSandboxCwd('my notes/draft 1')).toBe(true);
    // Interior whitespace is an ordinary directory name, not a hazard.
    expect(isSafeSandboxCwd('a b/c d')).toBe(true);
  });

  // Rejecting, never repairing: collapsing `..` lexically disagrees with the
  // filesystem across a symlink, so a "cleaned" path can resolve somewhere
  // other than where it was judged safe.
  it('rejects traversal, absolute and shell-expanded paths', () => {
    for (const value of [
      '',
      '..',
      '../other-user',
      'projects/../../etc',
      './projects',
      '/mnt/workspace/ws-other',
      '~/secrets',
      'projects//atlas',
      'projects/atlas/',
      '/',
      // The runtime strips the directory string while the shell `cd` keeps
      // its quotes, so these would leave the session disagreeing with itself
      // about where it is.
      'drafts ',
      ' drafts',
      'projects/atlas ',
      'x'.repeat(1025),
    ]) {
      expect(isSafeSandboxCwd(value)).toBe(false);
    }
  });
});
