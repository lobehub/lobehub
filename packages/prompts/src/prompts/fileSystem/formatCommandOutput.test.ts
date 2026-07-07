import { describe, expect, it } from 'vitest';

import { formatCommandOutput } from './formatCommandOutput';

describe('formatCommandOutput', () => {
  it('should format successful output without exit code', () => {
    const result = formatCommandOutput({
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved."`);
  });

  it('should suppress zero exit code when present', () => {
    const result = formatCommandOutput({
      exitCode: 0,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved."`);
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
      "Output retrieved.

      Exit code: 17

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
      "Output retrieved.

      Exit code: 1

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

  it('should not special-case missing exit code when formatting output', () => {
    const result = formatCommandOutput({
      output: 'still running',
      success: true,
    });

    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Output:
      still running"
    `);
  });
});
