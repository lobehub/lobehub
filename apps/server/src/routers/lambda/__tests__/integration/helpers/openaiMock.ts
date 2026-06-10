/**
 * OpenAI API Mock Helper
 *
 * Provides utilities to create mock OpenAI streaming responses
 * for E2E testing without hitting the real API.
 */

export const createMockOpenAIResponsesAPIStream = (
  content: string = 'Hello! How can I help you today?',
) => {
  const responseId = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;

  // Create Responses API event chunks
  const createChunks = () => [
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [],
        status: 'in_progress',
      },
      type: 'response.created',
    },
    {
      content_index: 0,
      delta: content,
      item_id: itemId,
      output_index: 0,
      type: 'response.output_text.delta',
    },
    {
      content_index: 0,
      item_id: itemId,
      output_index: 0,
      text: content,
      type: 'response.output_text.done',
    },
    {
      response: {
        created_at: Math.floor(Date.now() / 1000),
        id: responseId,
        model: 'gpt-5-pro',
        object: 'response',
        output: [
          { content: [{ text: content, type: 'output_text' }], role: 'assistant', type: 'message' },
        ],
        status: 'completed',
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          total_tokens: 30,
        },
      },
      type: 'response.completed',
    },
  ];

  // Factory to create fresh async iterator (since each iterator can only be consumed once)
  const createAsyncIterator = () => ({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of createChunks()) {
        yield chunk;
      }
    },
    toReadableStream: () =>
      new ReadableStream({
        start(controller) {
          for (const chunk of createChunks()) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
  });

  // Main iterator with tee method
  const mainIterator = createAsyncIterator();

  // Add tee method that returns two independent iterators
  return Object.assign(mainIterator, {
    tee: () => [createAsyncIterator(), createAsyncIterator()],
  });
};
