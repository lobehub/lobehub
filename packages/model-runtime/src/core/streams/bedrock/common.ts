import type {
  InvokeModelWithResponseStreamResponse,
  ResponseStream,
} from '@aws-sdk/client-bedrock-runtime';

import { readableFromAsyncIterable } from '../protocol';

const chatStreamable = async function* (stream: AsyncIterable<ResponseStream>) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const response of stream) {
    if (response.chunk) {
      buffer += decoder.decode(response.chunk.bytes, { stream: true });

      // Bedrock sends one JSON object per chunk, but TextDecoder with
      // stream: true may split a multi-byte character across boundaries.
      // Buffer until we can parse a complete JSON value.
      try {
        const chunk = JSON.parse(buffer);
        buffer = '';
        yield chunk;
      } catch {
        // Incomplete JSON — keep buffering until the next chunk completes it
      }
    } else {
      yield response;
    }
  }

  // Flush any remaining buffered data
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer);
    } catch (e) {
      console.error('bedrock stream: unable to parse final buffered chunk:', e);
    }
  }
};

/**
 * covert the bedrock response to a readable stream
 */
export const createBedrockStream = (res: InvokeModelWithResponseStreamResponse) =>
  readableFromAsyncIterable(chatStreamable(res.body!));
