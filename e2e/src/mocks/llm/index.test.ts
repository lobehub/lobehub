import { describe, expect, it } from 'vitest';

import type { EventSourceMessage } from '../../../../packages/utils/src/client/fetchEventSource/parse';
import {
  getLines,
  getMessages,
} from '../../../../packages/utils/src/client/fetchEventSource/parse';
import { buildSSEChunks, presetResponses } from '.';

const parseEventStream = (stream: string): EventSourceMessage[] => {
  const messages: EventSourceMessage[] = [];
  const onChunk = getLines(
    getMessages(
      () => {},
      (message) => messages.push(message),
    ),
  );
  const bytes = new TextEncoder().encode(stream);

  // Exercise the parser across arbitrary network boundaries instead of passing
  // the entire response as one buffer.
  for (let offset = 0; offset < bytes.length; offset += 7) {
    onChunk(bytes.subarray(offset, offset + 7));
  }

  return messages;
};

const parseTextPayload = (data: string): string => {
  const payload: unknown = JSON.parse(data);

  expect(typeof payload).toBe('string');

  return payload as string;
};

const expectTextRoundTrip = (content: string, chunkSize: number) => {
  const messages = parseEventStream(buildSSEChunks(content, chunkSize).join(''));

  for (const message of messages) {
    expect(message.event).not.toBe('');
    expect(() => JSON.parse(message.data)).not.toThrow();
  }

  const text = messages
    .filter((message) => message.event === 'text')
    .map((message) => parseTextPayload(message.data))
    .join('');

  expect(text).toBe(content);
};

describe('buildSSEChunks', () => {
  it.each([1, 3, 8, 10, 64])('round-trips JSON-sensitive text with chunk size %i', (chunkSize) => {
    expectTextRoundTrip('第一行\n第二行\r\n"quoted" \\ path 😀', chunkSize);
  });

  it('round-trips the multiline scroll fixture consumed by agent E2E tests', () => {
    expectTextRoundTrip(presetResponses.longScrollArticle, 10);
  });
});
