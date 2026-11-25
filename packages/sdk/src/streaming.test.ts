import { describe, expect, it } from 'vitest';

import { parseServerSentEvents } from './streaming';

const streamOf = (...chunks: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
};

const collect = async (stream: ReadableStream<Uint8Array>) => {
  const events = [];
  for await (const event of parseServerSentEvents(stream)) events.push(event);
  return events;
};

describe('parseServerSentEvents', () => {
  it('splits messages on blank lines and reads event/data/id', async () => {
    expect(
      await collect(streamOf('event: a\ndata: {"x":1}\nid: 7\n\n', 'data: plain\n\n')),
    ).toEqual([
      { data: '{"x":1}', event: 'a', id: '7' },
      { data: 'plain', event: undefined, id: '7' },
    ]);
  });

  it('joins multi-line data and skips comments', async () => {
    expect(await collect(streamOf(': keep-alive\n', 'data: a\ndata: b\n\n'))).toEqual([
      { data: 'a\nb', event: undefined, id: undefined },
    ]);
  });

  it('handles CRLF, a CRLF split across chunks, and a missing final blank line', async () => {
    expect(await collect(streamOf('data: one\r', '\n\r\ndata: two'))).toEqual([
      { data: 'one', event: undefined, id: undefined },
      { data: 'two', event: undefined, id: undefined },
    ]);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: 你好\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    expect((await collect(stream))[0].data).toBe('你好');
  });
});
