/**
 * Shared helpers for aiAgent integration tests
 */
import { type AgentState } from '@lobechat/agent-runtime';
import { vi } from 'vitest';

import { type IAgentStateManager } from '@/server/modules/AgentRuntime/types';

/**
 * Wait for an operation to complete (or reach terminal state)
 *
 * @param stateManager - The agent state manager to check state
 * @param operationId - The operation ID to wait for
 * @param options - Configuration options
 * @returns The final state when complete
 */
export const waitForOperationComplete = async (
  stateManager: IAgentStateManager,
  operationId: string,
  options?: {
    /** Maximum time to wait in ms (default: 30000) */
    maxWaitTime?: number;
    /** Polling interval in ms (default: 100) */
    pollInterval?: number;
  },
): Promise<AgentState> => {
  const { maxWaitTime = 30_000, pollInterval = 100 } = options ?? {};
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const state = await stateManager.loadAgentState(operationId);
    if (!state) {
      throw new Error(`Operation ${operationId} not found`);
    }

    // Check for terminal states
    if (['done', 'error', 'interrupted', 'waiting_for_human'].includes(state.status)) {
      return state;
    }

    // Wait before next poll
    await new Promise((resolve) => {
      setTimeout(resolve, pollInterval);
    });
  }

  throw new Error(`Operation ${operationId} did not complete within ${maxWaitTime}ms`);
};

// Mock FileService to avoid S3 environment variable requirements
// This mock needs to be in a shared place but vitest hoists vi.mock
// So each test file should import and use this constant
export const FILE_SERVICE_MOCK = {
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: vi.fn().mockImplementation((path: string) => (path ? `/files${path}` : null)),
  })),
};

/**
 * Helper to create a mock OpenAI Responses API stream from an array of chunks.
 * This creates an async iterable with tee() method that matches the OpenAI SDK response format.
 */
export const createMockResponsesStream = <T>(chunks: T[]) => {
  const createAsyncIterator = () => ({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    toReadableStream: () =>
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
  });

  const mainIterator = createAsyncIterator();
  return Object.assign(mainIterator, {
    tee: () => [createAsyncIterator(), createAsyncIterator()],
  });
};

/**
 * Helper to create mock streaming response for OpenAI Responses API
 */
export const createMockResponsesAPIStream = (
  content: string = 'Hello! How can I help you today?',
) => {
  const responseId = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;

  const chunks = [
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
          {
            content: [{ text: content, type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
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

  return createMockResponsesStream(chunks);
};
