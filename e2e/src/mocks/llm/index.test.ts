import { describe, expect, it, vi } from 'vitest';

import type { EventSourceMessage } from '../../../../packages/utils/src/client/fetchEventSource/parse';
import {
  getLines,
  getMessages,
} from '../../../../packages/utils/src/client/fetchEventSource/parse';
import { buildSSEChunks, LLMMockManager, presetResponses } from '.';
import type * as LLMMockServer from './server';
import { registerLLMReplies } from './server';

vi.mock('./server', async (importOriginal) => ({
  ...(await importOriginal<typeof LLMMockServer>()),
  registerLLMReplies: vi.fn(),
}));

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

// Regression: the setters only queued the registration POST and returned void, so a
// step that registered a reply and sent the prompt right away could reach the shared
// server-side endpoint first and get the default reply.
describe('LLMMockManager reply registration', () => {
  it.each(['setResponse', 'setResponseContaining'] as const)(
    '%s settles only after the reply reaches the endpoint',
    async (method) => {
      let release!: () => void;
      vi.mocked(registerLLMReplies).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      const manager = new LLMMockManager();
      let settled = false;

      const registration = Promise.resolve(manager[method]('prompt', 'reply')).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(registerLLMReplies).toHaveBeenCalled();
      expect(settled).toBe(false);

      release();
      await registration;
      expect(settled).toBe(true);
    },
  );
});
