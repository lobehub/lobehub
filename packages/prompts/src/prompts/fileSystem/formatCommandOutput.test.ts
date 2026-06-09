import { describe, expect, it } from 'vitest';

import { formatCommandOutput } from './formatCommandOutput';

describe('formatCommandOutput', () => {
  it('should format successful output without exit code', () => {
    const result = formatCommandOutput({
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved."`);
  });

  it('should include exit code when present', () => {
    const result = formatCommandOutput({
      exitCode: 0,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Exit code: 0"
    `);
  });

  it('should format successful output with content', () => {
    const result = formatCommandOutput({
      exitCode: 17,
      output: 'Process output here',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Output retrieved.

      Exit code: 17

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
});
