import { describe, expect, it } from 'vitest';

import { formatCommandOutput } from './formatCommandOutput';

describe('formatCommandOutput', () => {
  it('should format successful output without a reported lifecycle', () => {
    const result = formatCommandOutput({
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved."`);
  });

  it('should state completion when the command exited cleanly', () => {
    const result = formatCommandOutput({
      exitCode: 0,
      output: 'all good',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Output:
      all good"
    `);
  });

  it('should format duration in seconds when present', () => {
    const result = formatCommandOutput({
      durationMs: 45_400,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Duration: 45s"
    `);
  });

  it('should format completed output with non-zero exit code', () => {
    const result = formatCommandOutput({
      durationMs: 123_000,
      exitCode: 17,
      output: 'Process output here',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command failed with exit code 17

      Duration: 123s

      Output:
      Process output here"
    `);
  });

  it('should format failed output', () => {
    const result = formatCommandOutput({
      error: 'Process not found',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed: Process not found"`);
  });

  it('should format successful output with error info', () => {
    const result = formatCommandOutput({
      error: 'Warning message',
      exitCode: 1,
      output: 'Some output',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Command failed with exit code 1

      Output:
      Some output

      Error: Warning message"
    `);
  });

  it('should format output as-is when it contains saved file metadata', () => {
    const result = formatCommandOutput({
      output:
        'head\n... [omitted 12000 bytes; full output saved to: /tmp/lobehub-shell/output.log]\ntail',
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Output:
      head
      ... [omitted 12000 bytes; full output saved to: /tmp/lobehub-shell/output.log]
      tail"
    `);
  });

  it('should keep small saved output as normal output', () => {
    const result = formatCommandOutput({
      output: 'small output',
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Output:
      small output"
    `);
  });

  it('should format output file metadata', () => {
    const result = formatCommandOutput({
      output: 'preview output',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/stdout.log', size: 1536, truncated: false },
      },
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Full stdout saved to: /tmp/lobehub-shell/stdout.log (1.5KB)

      Output:
      preview output"
    `);
  });

  it('should format truncated output file metadata', () => {
    const result = formatCommandOutput({
      output: 'preview output',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/stdout.log', size: 1536, truncated: true },
      },
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Stdout too large (1.5KB). Full stdout saved to: /tmp/lobehub-shell/stdout.log

      Output:
      preview output"
    `);
  });

  // A still-running observation and a finished-but-silent one carry the exact
  // same fields: empty output, a 0-byte log, a duration. Only the header tells
  // them apart, so both renders are pinned here.
  describe('lifecycle is always stated', () => {
    it('should say the command is still running and how to wait for it', () => {
      const result = formatCommandOutput({
        canWaitLonger: true,
        durationMs: 137_421,
        outputFiles: {
          stdout: { path: '/tmp/lobehub-shell/sh-197/stdout.log', size: 0, truncated: false },
        },
        running: true,
        shellId: 'sh-197',
        success: true,
      });

      expect(result).toMatchInlineSnapshot(`
        "Command is still running.
        shell_id: sh-197

        Pass a larger \`timeout\` (ms) to wait for it within a single call instead of polling repeatedly; \`killCommand\` ends the session.

        Elapsed: 137s

        Full stdout saved to: /tmp/lobehub-shell/sh-197/stdout.log (0 bytes)

        (no output yet)"
      `);
    });

    it('should not render the same way once the command has exited silently', () => {
      const result = formatCommandOutput({
        durationMs: 281_914,
        exitCode: 0,
        outputFiles: {
          stdout: { path: '/tmp/lobehub-shell/sh-197/stdout.log', size: 0, truncated: false },
        },
        running: false,
        shellId: 'sh-197',
        success: true,
      });

      expect(result).toMatchInlineSnapshot(`
        "Command completed successfully.

        Duration: 282s

        Full stdout saved to: /tmp/lobehub-shell/sh-197/stdout.log (0 bytes)

        (no output)"
      `);
    });

    it('should omit the shell id when the caller did not supply one', () => {
      const result = formatCommandOutput({
        canWaitLonger: true,
        running: true,
        success: true,
      });

      expect(result).toMatchInlineSnapshot(`
        "Command is still running.

        Pass a larger \`timeout\` (ms) to wait for it within a single call instead of polling repeatedly; \`killCommand\` ends the session.

        (no output yet)"
      `);
    });

    // A backend whose schema has no `timeout` must not be told to raise one.
    it('should not advise a longer wait the backend cannot offer', () => {
      const result = formatCommandOutput({
        running: true,
        shellId: 'cmd-1',
        success: true,
      });

      expect(result).toMatchInlineSnapshot(`
        "Command is still running.
        shell_id: cmd-1

        Give it time before checking again; \`killCommand\` ends the session.

        (no output yet)"
      `);
    });
  });

  it('should attribute an empty render to the filter when the log is not empty', () => {
    const result = formatCommandOutput({
      exitCode: 0,
      filter: 'Test Files|FAIL',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/sh-197/stdout.log', size: 925, truncated: false },
      },
      running: false,
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Command completed successfully.

      Full stdout saved to: /tmp/lobehub-shell/sh-197/stdout.log (925 bytes)

      (filter "Test Files|FAIL" matched no lines — call again without \`filter\` to see the raw output)"
    `);
  });

  it('should not blame the filter when the command genuinely wrote nothing', () => {
    const result = formatCommandOutput({
      exitCode: 0,
      filter: 'anything',
      outputFiles: {
        stdout: { path: '/tmp/lobehub-shell/sh-197/stdout.log', size: 0, truncated: false },
      },
      running: false,
      success: true,
    });

    expect(result).toContain('(no output)');
    expect(result).not.toContain('matched no lines');
  });
});
