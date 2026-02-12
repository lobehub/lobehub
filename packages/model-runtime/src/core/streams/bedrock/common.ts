import type {
  InvokeModelWithResponseStreamResponse,
  ResponseStream,
} from '@aws-sdk/client-bedrock-runtime';

import { readableFromAsyncIterable } from '../protocol';

const chatStreamable = async function* (stream: AsyncIterable<ResponseStream>) {
  for await (const response of stream) {
    if (response.chunk) {
      const decoder = new TextDecoder();

      const value = decoder.decode(response.chunk.bytes, { stream: true });
      try {
        const chunk = JSON.parse(value);

        yield chunk;
      } catch (e) {
        console.log('bedrock stream parser error:', e);

        yield value;
      }
    } else {
      yield response;
    }
  }
};

/**
 * covert the bedrock response to a readable stream
 */
export const createBedrockStream = (res: InvokeModelWithResponseStreamResponse) =>
  readableFromAsyncIterable(chatStreamable(res.body!));
