import { describe, expect, it } from 'vitest';

import { formatCommandResult } from './formatCommandResult';

describe('formatCommandResult', () => {
  it('should format successful command without output', () => {
    const result = formatCommandResult({ exitCode: 0, success: true });
    expect(result).toMatchInlineSnapshot(`"Command completed successfully."`);
  });

  it('should format still-running command', () => {
    const result = formatCommandResult({
      shellId: 'shell-123',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command is still running after the wait window.
      shell_id: shell-123"
    `);
  });

  it('should format still-running command with output file path', () => {
    const result = formatCommandResult({
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/stdout.log', size: 1536, truncated: false },
      },
      shellId: 'shell-123',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command is still running after the wait window.
      shell_id: shell-123

      Full stdout saved to: /tmp/lobehub-shell/stdout.log (1.5KB)"
    `);
  });

  it('should format successful command with output', () => {
    const result = formatCommandResult({
      exitCode: 0,
      stdout: 'Hello World',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Stdout:
      Hello World"
    `);
  });

  it('should format command output when it contains saved file metadata', () => {
    const result = formatCommandResult({
      exitCode: 0,
      stdout:
        'first lines\n... [omitted 12000 bytes; full output saved to: /tmp/lobehub-shell/output.log]\nlast lines',
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Stdout:
      first lines
      ... [omitted 12000 bytes; full output saved to: /tmp/lobehub-shell/output.log]
      last lines"
    `);
  });

  it('should format command output file metadata without large-output wording when not truncated', () => {
    const result = formatCommandResult({
      exitCode: 0,
      stdout: 'small output',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/stdout.log', size: 1536, truncated: false },
      },
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Full stdout saved to: /tmp/lobehub-shell/stdout.log (1.5KB)

      Stdout:
      small output"
    `);
  });

  it('should format truncated command output file metadata', () => {
    const result = formatCommandResult({
      exitCode: 0,
      stdout: 'preview output',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/stdout.log', size: 1536, truncated: true },
      },
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Stdout too large (1.5KB). Full stdout saved to: /tmp/lobehub-shell/stdout.log

      Stdout:
      preview output"
    `);
  });

  it('should suppress the Exit code line when exitCode is 0', () => {
    const result = formatCommandResult({
      exitCode: 0,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Command completed successfully."`);
  });

  it('should treat shell id with exitCode 0 as completed', () => {
    const result = formatCommandResult({
      exitCode: 0,
      shellId: 'shell-123',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Command completed successfully."`);
  });

  it('should treat a non-zero exit code as failure even when envelope success is true', () => {
    const result = formatCommandResult({
      exitCode: 137,
      stdout: 'partial output',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command failed with exit code 137

      Stdout:
      partial output"
    `);
  });

  it('should format failed command', () => {
    const result = formatCommandResult({
      error: 'Permission denied',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Command failed: Permission denied"`);
  });

  it('should format command with all fields', () => {
    const result = formatCommandResult({
      error: 'Command error',
      exitCode: 1,
      stdout: 'Some output',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command failed with exit code 1: Command error

      Stdout:
      Some output"
    `);
  });
});
