// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { truncateToolResult, truncateToolResultWithState } from '../truncateToolResult';

const validEmoji = '\uD83D\uDC1B';
const familyEmoji = '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66';

const getTruncatedPortion = (value: string) => value.split('\n\n[Content truncated')[0];
const endsWithHighSurrogate = (value: string) => {
  const lastCharCode = value.charCodeAt(value.length - 1);

  return lastCharCode >= 0xd8_00 && lastCharCode <= 0xdb_ff;
};

describe('truncateToolResult', () => {
  it('returns content unchanged when within the limit', () => {
    expect(truncateToolResult('hello', 100)).toBe('hello');
  });

  it('truncates and appends a notice when over the limit', () => {
    const result = truncateToolResult('0123456789', 5);

    expect(result.startsWith('01234')).toBe(true);
    expect(result).toContain('Content truncated');
  });

  it('does not leave a lone high surrogate when the cutoff splits an emoji', () => {
    const content = `prefix ${'a'.repeat(10)}${validEmoji} suffix`;
    const limit = 'prefix '.length + 10 + 1;
    const result = truncateToolResult(content, limit);
    const truncatedPortion = getTruncatedPortion(result);

    expect(result).toContain('[Content truncated:');
    expect(truncatedPortion).toBe(`prefix ${'a'.repeat(10)}`);
    expect(endsWithHighSurrogate(truncatedPortion)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('\\ud83d"');
  });

  it('keeps a full emoji when the complete surrogate pair fits', () => {
    const content = `prefix ${'a'.repeat(10)}${validEmoji} suffix`;
    const limit = 'prefix '.length + 10 + validEmoji.length;
    const result = truncateToolResult(content, limit);

    expect(result).toContain(validEmoji);
    expect(result).toContain('[Content truncated:');
  });

  it('never leaves a lone high surrogate inside a ZWJ-composed emoji at any cutoff', () => {
    const content = `ab${familyEmoji}cd`;

    for (let cutoff = 1; cutoff < content.length; cutoff += 1) {
      const result = truncateToolResult(content, cutoff);
      const truncatedPortion = getTruncatedPortion(result);

      expect(endsWithHighSurrogate(truncatedPortion), `cutoff=${cutoff}`).toBe(false);
      expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
    }
  });

  it('preserves state while truncating content safely', () => {
    const result = truncateToolResultWithState(
      { content: `value ${'x'.repeat(4)}${validEmoji} tail`, state: { ok: true } },
      'value '.length + 4 + 1,
    );

    expect(result.state).toEqual({ ok: true });
    expect(endsWithHighSurrogate(getTruncatedPortion(result.content))).toBe(false);
  });
});
