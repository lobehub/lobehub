import { describe, expect, it } from 'vitest';

import { formatCommandOutput } from './formatCommandOutput';

describe('formatCommandOutput', () => {
  it('should format successful output while running', () => {
    const result = formatCommandOutput({
      running: true,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved. Running: true"`);
  });

  it('should format successful output when not running', () => {
    const result = formatCommandOutput({
      running: false,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Output retrieved. Running: false"`);
  });

  it('should format successful output with content', () => {
    const result = formatCommandOutput({
      output: 'Process output here',
      running: true,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Output retrieved. Running: true

      Output:
      Process output here"
    `);
  });

  it('should format failed output', () => {
    const result = formatCommandOutput({
      error: 'Process not found',
      running: false,
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed: Process not found"`);
  });

  it('should format successful output with error info', () => {
    const result = formatCommandOutput({
      error: 'Warning message',
      output: 'Some output',
      running: false,
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Output retrieved. Running: false

      Output:
      Some output

      Error: Warning message"
    `);
  });
});
