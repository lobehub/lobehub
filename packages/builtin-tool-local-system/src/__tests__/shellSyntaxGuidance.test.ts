import { describe, expect, it } from 'vitest';

import { getShellSyntaxGuidance } from '../shellSyntaxGuidance';

describe('getShellSyntaxGuidance', () => {
  it('gives bash guidance for Git Bash and never mentions PowerShell as the target', () => {
    const guidance = getShellSyntaxGuidance('Git Bash');

    expect(guidance).toContain('POSIX/bash');
    expect(guidance).toContain('do NOT use PowerShell');
  });

  it('warns about missing chain operators only for Windows PowerShell 5.1', () => {
    expect(getShellSyntaxGuidance('Windows PowerShell 5.1')).toContain('NOT available');
    expect(getShellSyntaxGuidance('PowerShell 7+ (pwsh)')).toContain('are available');
  });

  it('gives cmd guidance for cmd.exe', () => {
    expect(getShellSyntaxGuidance('cmd.exe')).toContain('cmd.exe syntax');
  });

  it('gives POSIX guidance for /bin/sh', () => {
    expect(getShellSyntaxGuidance('/bin/sh')).toBe('Write POSIX shell syntax.');
  });

  it('falls back to the shell-conditional wording when the shell is unknown', () => {
    for (const value of [undefined, '', 'something-else']) {
      expect(getShellSyntaxGuidance(value)).toContain('When that shell is PowerShell');
    }
  });

  it('matches display names case-insensitively', () => {
    expect(getShellSyntaxGuidance('git bash')).toContain('POSIX/bash');
  });
});
