import { describe, expect, it, vi } from 'vitest';

import { getLines, getMessages } from './parse';

describe('SSE message dispatch', () => {
  it.each([': keep-alive\n\n', '\n', 'id: 42\n\n', 'event: ignored\n\n'])(
    'ignores blocks without data: %j',
    (prefix) => {
      const onMessage = vi.fn();
      const onLine = getLines(getMessages(vi.fn(), onMessage));
      const bytes = new TextEncoder().encode(`${prefix}event: text\ndata: hello\n\n`);

      // Exercise network fragmentation as well as complete event boundaries.
      for (const byte of bytes) onLine(new Uint8Array([byte]));

      expect(onMessage.mock.calls.map(([message]) => message)).toEqual([
        { data: 'hello', event: 'text', id: '', retry: undefined },
      ]);
    },
  );

  it('preserves ID updates and resets without dispatching ID-only blocks', () => {
    const onId = vi.fn();
    const onMessage = vi.fn();
    const parse = getLines(getMessages(onId, onMessage));

    parse(new TextEncoder().encode('id: 42\n\nid:\n\n'));

    expect(onId.mock.calls).toEqual([['42'], ['']]);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('preserves explicit empty data and resets data presence after dispatch', () => {
    const onMessage = vi.fn();
    const parse = getLines(getMessages(vi.fn(), onMessage));

    parse(new TextEncoder().encode('data:\n\n: heartbeat\n\ndata: first\ndata: second\n\n\n'));

    expect(onMessage.mock.calls.map(([message]) => message.data)).toEqual(['', 'first\nsecond']);
  });
});
