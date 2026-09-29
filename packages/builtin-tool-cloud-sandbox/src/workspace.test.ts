import { describe, expect, it } from 'vitest';

import { formatSandboxWorkspacePromptVariables } from './workspace';

describe('formatSandboxWorkspacePromptVariables', () => {
  it('leaves the ephemeral wording exactly as a run without persistence has always had it', () => {
    // The ordinary sandbox is every free run and every topic that never asked
    // for persistence; its prompt must not drift because the persistent one
    // gained a rule.
    expect(formatSandboxWorkspacePromptVariables()).toEqual({
      sandbox_session_files: '- Files from previous sessions may not persist',
      sandbox_workspace: [
        '- Files created here are temporary and session-specific',
        '- Each conversation topic has its own isolated session',
        '- Sessions may expire after inactivity; files will be recreated if needed',
        '- The sandbox has its own isolated file system starting at the root directory',
      ].join('\n'),
    });
    expect(formatSandboxWorkspacePromptVariables({ mode: 'ephemeral' })).toEqual(
      formatSandboxWorkspacePromptVariables(),
    );
  });

  it('tells a persistent run to work where it starts rather than in scratch space', () => {
    const { sandbox_workspace: prompt } = formatSandboxWorkspacePromptVariables({
      cwd: 'hello-dev',
      mode: 'persistent',
    });

    expect(prompt).toContain('`hello-dev`');
    expect(prompt).toContain('Every call starts you in that directory');
    expect(prompt).toContain('scratch directory');
  });

  it('says the same about placement when no subdirectory was chosen', () => {
    const { sandbox_workspace: prompt } = formatSandboxWorkspacePromptVariables({
      mode: 'persistent',
    });

    expect(prompt).toContain('Every call starts you in that directory');
  });

  it('describes a built instance by where its commands actually start', () => {
    // The checkout lives on local disk and the session saves it into the
    // instance's directory, so a prompt that names the volume directory as the
    // working directory disagrees with `pwd` — and a model that notices goes
    // hunting for the "real" one.
    const { sandbox_workspace: prompt } = formatSandboxWorkspacePromptVariables({
      cwd: 'r18-copy',
      mode: 'persistent',
      workingDir: '/root/work',
    });

    expect(prompt).toContain('You start in `/root/work`');
    expect(prompt).toContain('`r18-copy`');
    expect(prompt).toContain('Do not move the task there');
    expect(prompt).not.toContain('Your working directory is `r18-copy`');
  });
});

describe('the placement text the skills runtime also renders', () => {
  it('keeps the ephemeral default renderable without any persistence input', () => {
    // The skills tool now carries `{{sandbox_workspace}}` too, and its prompt
    // is assembled for every run — including the ones with no entitlement, where
    // the variable generators call this with nothing.
    const { sandbox_workspace: prompt } = formatSandboxWorkspacePromptVariables();

    expect(prompt).toContain('Files created here are temporary and session-specific');
    expect(prompt).not.toContain('{{');
  });
});
