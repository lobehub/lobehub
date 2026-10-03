import { describe, expect, it } from 'vitest';

import { readProtocolChunks } from './protocolChunks';

const streamOf = (...parts: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
};

const collect = async (body: ReadableStream<Uint8Array>) => {
  const chunks = [];
  for await (const chunk of readProtocolChunks(body)) chunks.push(chunk);
  return chunks;
};

describe('readProtocolChunks', () => {
  it('parses SSE protocol events back into chunks', async () => {
    const chunks = await collect(
      streamOf(
        'id: chat_1\nevent: text\ndata: "Hel"\n\n',
        'id: chat_1\nevent: text\ndata: "lo"\n\n',
        'id: chat_1\nevent: usage\ndata: {"totalTokens":3}\n\n',
      ),
    );

    expect(chunks).toEqual([
      { data: 'Hel', id: 'chat_1', type: 'text' },
      { data: 'lo', id: 'chat_1', type: 'text' },
      { data: { totalTokens: 3 }, id: 'chat_1', type: 'usage' },
    ]);
  });

  it('reassembles events split across network reads', async () => {
    const chunks = await collect(
      streamOf('event: reas', 'oning\ndata: "thi', 'nk"\n', '\nevent: text\ndata: "ok"\n\n'),
    );

    expect(chunks).toEqual([
      { data: 'think', type: 'reasoning' },
      { data: 'ok', type: 'text' },
    ]);
  });

  it('keeps a trailing event without the closing blank line and CRLF framing', async () => {
    const chunks = await collect(
      streamOf('event: text\r\ndata: "a"\r\n\r\nevent: stop\r\ndata: "stop"'),
    );

    expect(chunks).toEqual([
      { data: 'a', type: 'text' },
      { data: 'stop', type: 'stop' },
    ]);
  });
});
