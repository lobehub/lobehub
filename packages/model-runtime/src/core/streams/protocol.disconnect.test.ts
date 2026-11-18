import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { convertIterableToStream, createFirstErrorHandleTransformer } from './protocol';

const drain = async (readable: ReadableStream<any>) => {
  const reader = readable.getReader();
  const chunks: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
};

describe('createFirstErrorHandleTransformer upstream disconnects', () => {
  it('should classify an upstream socket drop as ProviderStreamInterrupted', async () => {
    // undici's shape when the provider resets the connection mid-body
    // (op_1794405705354).
    async function* erroringStream() {
      yield 'first';
      throw new TypeError('terminated', { cause: new Error('read ECONNRESET') });
    }

    const chunks = await drain(
      convertIterableToStream(erroringStream()).pipeThrough(
        createFirstErrorHandleTransformer(undefined, 'lobehub'),
      ),
    );

    expect(chunks[1].causeMessage).toBe('read ECONNRESET');
    expect(chunks[1].errorType).toBe(AgentRuntimeErrorType.ProviderStreamInterrupted);
  });

  it('should keep ProviderBizError for other iterator failures', async () => {
    async function* erroringStream() {
      yield 'first';
      throw new Error('rate limit');
    }

    const chunks = await drain(
      convertIterableToStream(erroringStream()).pipeThrough(createFirstErrorHandleTransformer()),
    );

    expect(chunks[1].errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
  });

  it('should let the provider error handler win over disconnect detection', async () => {
    async function* erroringStream() {
      yield 'first';
      throw new TypeError('terminated');
    }

    const chunks = await drain(
      convertIterableToStream(erroringStream()).pipeThrough(
        createFirstErrorHandleTransformer(() => AgentRuntimeErrorType.InvalidProviderAPIKey),
      ),
    );

    expect(chunks[1].errorType).toBe(AgentRuntimeErrorType.InvalidProviderAPIKey);
  });
});
