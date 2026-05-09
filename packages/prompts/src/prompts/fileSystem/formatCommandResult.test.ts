import { describe, expect, it } from 'vitest';

import { formatCommandResult } from './formatCommandResult';

describe('formatCommandResult', () => {
  it('should format successful command without output', () => {
    const result = formatCommandResult({ success: true });
    expect(result).toMatchInlineSnapshot(`"Command completed successfully."`);
  });

  it('should format successful background command', () => {
    const result = formatCommandResult({
      shellId: 'shell-123',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(
      `"Command started in background with shell_id: shell-123"`,
    );
  });

  it('should format successful command with stdout', () => {
    const result = formatCommandResult({
      stdout: 'Hello World',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Output:
      Hello World"
    `);
  });

  it('should format successful command with stderr', () => {
    const result = formatCommandResult({
      stderr: 'Warning: deprecated',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Stderr:
      Warning: deprecated"
    `);
  });

  it('should suppress the Exit code line when exitCode is 0', () => {
    const result = formatCommandResult({
      exitCode: 0,
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

      Output:
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
      stderr: 'Error occurred',
      stdout: 'Some output',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command failed with exit code 1: Command error

      Output:
      Some output

      Stderr:
      Error occurred"
    `);
  });
});
