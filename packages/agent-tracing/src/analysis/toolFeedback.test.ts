import { describe, expect, it } from 'vitest';

import { classifyToolError } from './toolFeedback';

describe('classifyToolError', () => {
  it('trusts an explicit isSuccess flag over content', () => {
    expect(classifyToolError('everything fine', false)).toBe(true);
    // successful read of a file that talks about errors is NOT a failure
    expect(classifyToolError('Error handling guide: ...'.repeat(500), true)).toBe(false);
  });

  it('mixed crawlResults with successful pages is not a failure', () => {
    const mixed =
      '<crawlResults>\n  <error errorType="Error" errorMessage="500" />\n  <page url="https://a.com">content</page>\n</crawlResults>';
    expect(classifyToolError(mixed, undefined)).toBe(false);
  });

  it('crawlResults with only error entries is a failure', () => {
    const allErr =
      '<crawlResults>\n  <error errorType="Error" errorMessage="Browserless 500" />\n  <error errorType="Error" errorMessage="Browserless 500" />\n</crawlResults>';
    expect(classifyToolError(allErr, undefined)).toBe(true);
  });

  it('falls back to the head regex only for short unflagged outputs', () => {
    expect(classifyToolError('Error: ENOENT no such file', undefined)).toBe(true);
    // long content mentioning "error" is usually mixed content, not a failure
    const longDoc = `# Handling error states\n${'body text '.repeat(600)}`;
    expect(classifyToolError(longDoc, undefined)).toBe(false);
  });
});
