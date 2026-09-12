// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { splitFallbackMessageBatches, splitFallbackMessages } from './attachmentBudget';

describe('fallback message batching', () => {
  it.each([
    { lines: [], maxChars: 5, messages: [] },
    { lines: ['a'], maxChars: 5, messages: ['a'] },
    { lines: ['a', 'bb'], maxChars: 5, messages: ['a\n\nbb'] },
    { lines: ['a', 'bbb'], maxChars: 5, messages: ['a', 'bbb'] },
    { lines: ['aa', 'bb', 'cc'], maxChars: 5, messages: ['aa', 'bb', 'cc'] },
    { lines: ['too long'], maxChars: 5, messages: ['too long'] },
    { lines: ['', 'a', ''], maxChars: 5, messages: ['a\n\n'] },
    { lines: ['', ''], maxChars: 5, messages: [] },
  ])(
    'preserves message text for $lines at $maxChars characters',
    ({ lines, maxChars, messages }) => {
      const items = lines.map((line, index) => ({ index, line }));
      const batches = splitFallbackMessageBatches(items, (item) => item.line, maxChars);

      expect(batches.map((batch) => batch.message)).toEqual(messages);
      expect(splitFallbackMessages(lines, maxChars)).toEqual(messages);
    },
  );

  it('retains input references and order when repeated lines span multiple batches', () => {
    const first = { index: 0, line: 'aa' };
    const second = { index: 1, line: 'aa' };
    const third = { index: 2, line: 'bb' };
    const batches = splitFallbackMessageBatches([first, second, third], (item) => item.line, 6);

    expect(batches).toEqual([
      { items: [first, second], message: 'aa\n\naa' },
      { items: [third], message: 'bb' },
    ]);
    expect(batches[0].items[0]).toBe(first);
    expect(batches[0].items[1]).toBe(second);
    expect(batches[1].items[0]).toBe(third);
  });
});
