import { describe, expect, it } from 'vitest';

import { formatSandboxStoragePromptVariables } from './workspace';

describe('formatSandboxStoragePromptVariables', () => {
  it('tells a temporary run it is discarded after use, and what it suits', () => {
    // The ordinary sandbox is every free run and every topic that never asked
    // for persistence; it keeps its original lines and adds what it is for.
    expect(formatSandboxStoragePromptVariables()).toEqual({
      sandbox_session_files: '- Files from previous sessions may not persist',
      sandbox_workspace: [
        '- Files created here are temporary and session-specific',
        '- Each conversation topic has its own isolated session',
        '- Sessions may expire after inactivity; files will be recreated if needed',
        '- The sandbox has its own isolated file system starting at the root directory',
        '- This is a temporary sandbox, discarded after use: results and intermediate files are not kept once it is gone. It suits coding on a repository and one-off data processing, where nothing along the way needs keeping. Anything the user wants to keep has to leave the sandbox — export finished files with `exportFile`.',
      ].join('\n'),
    });
    // A deployment without persistence must not be pointed at a drive.
    expect(formatSandboxStoragePromptVariables().sandbox_workspace).not.toMatch(/drive/i);
    expect(formatSandboxStoragePromptVariables({ mode: 'ephemeral' })).toEqual(
      formatSandboxStoragePromptVariables(),
    );
  });

  it('tells a persistent run to work where it starts rather than in scratch space', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
      cwd: 'hello-dev',
      mode: 'persistent',
    });

    expect(prompt).toContain('`hello-dev`');
    expect(prompt).toContain('Every call starts you in that directory');
    expect(prompt).toContain('scratch directory');
  });

  it('says the same about placement when no subdirectory was chosen', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
      mode: 'persistent',
    });

    expect(prompt).toContain('Every call starts you in that directory');
  });

  it('describes a built instance by where its commands actually start', () => {
    // The checkout lives on local disk and the session saves it into the
    // instance's directory, so a prompt that names the volume directory as the
    // working directory disagrees with `pwd` — and a model that notices goes
    // hunting for the "real" one.
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
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

describe('the three placements a run can have', () => {
  it('names a drive folder as a folder on the network drive', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
      cwd: 'reports',
      mode: 'drive',
    });

    expect(prompt).toContain("`reports`, a folder on the user's **network drive**");
    expect(prompt).toContain('Keep to this folder');
    // A drive restores nothing but files, so the model must not count on
    // installed packages being there next time.
    expect(prompt).toContain('packages you install');
    expect(prompt).not.toContain('environment directory');
  });

  it('names the drive root when no folder narrows it', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({ mode: 'drive' });

    expect(prompt).toContain("the root of the user's **network drive**");
    expect(prompt).toContain('its own subfolder');
  });

  // The persistent sandbox is for everyday work; coding belongs in the
  // temporary one, where dependencies and build output cost no drive space.
  it('tells a drive run it is for everyday tasks, and to send coding to the Cloud Sandbox', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
      cwd: 'reports',
      mode: 'drive',
    });

    expect(prompt).toContain('meant for everyday tasks');
    expect(prompt).toContain('It is not meant for coding');
    expect(prompt).toContain('switch this conversation to the Cloud Sandbox');
  });

  it('names an instance as an environment directory whose packages come back', () => {
    const { sandbox_workspace: prompt } = formatSandboxStoragePromptVariables({
      cwd: 'notes-env',
      mode: 'persistent',
    });

    expect(prompt).toContain('`notes-env`, an **environment directory**');
    expect(prompt).not.toContain('network drive**:');
  });

  it('persists files in both persistent placements and not in the temporary one', () => {
    const persisted = '- Files in your working directory persist across sessions';

    expect(formatSandboxStoragePromptVariables({ mode: 'drive' }).sandbox_session_files).toContain(
      persisted,
    );
    expect(
      formatSandboxStoragePromptVariables({ mode: 'persistent' }).sandbox_session_files,
    ).toContain(persisted);
    expect(
      formatSandboxStoragePromptVariables({ mode: 'ephemeral' }).sandbox_session_files,
    ).not.toContain(persisted);
  });
});
