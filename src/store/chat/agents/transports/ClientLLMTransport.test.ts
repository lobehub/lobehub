import { ModelEmptyError } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '../../store';
import { ClientLLMTransport } from './ClientLLMTransport';

// A grounding-only completion streams no text into `content`, but carries
// citation metadata and burns real output tokens. The stream (driven via
// `chatService.getChatCompletion`) finishes with `grounding` + `usage`, and the
// StreamingHandler surfaces the grounding as `metadata.search`.
const grounding = { citations: ['https://example.com'] } as any;
const usage = { totalOutputTokens: 25_220 } as any;

let finishGrounding: unknown = grounding;

vi.mock('@/services/chat', () => ({
  chatService: {
    getChatCompletion: vi.fn(async (_params: any, options: any) => {
      await options.onFinish?.('', {
        grounding: finishGrounding,
        traceId: 'trace-1',
        type: 'stop',
        usage,
      });
    }),
  },
}));

vi.mock('@/store/file/store', () => ({ getFileStoreState: () => ({}) }));

vi.mock('../StreamingHandler', () => ({
  StreamingHandler: class {
    handleFinish(finishData: any) {
      return {
        content: '',
        finishType: finishData.type,
        isFunctionCall: false,
        metadata: { search: finishData.grounding ?? undefined, usage: finishData.usage },
        toolCalls: [],
        tools: [],
        usage: finishData.usage,
      };
    }
    getOutput() {
      return '';
    }
    getThinkingContent() {
      return '';
    }
    getContentParts() {
      return [];
    }
    getReasoningParts() {
      return [];
    }
    handleChunk() {}
    hasContentImages() {
      return false;
    }
    hasReasoningImages() {
      return false;
    }
  },
}));

const createTransport = () => {
  const operation = {
    abortController: new AbortController(),
    context: { agentId: 'agent-1', topicId: 'topic-1' },
    status: 'running',
  };
  const store = {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    internal_transformToolCalls: vi.fn((calls: unknown) => calls),
    operations: { 'op-1': operation },
    startOperation: vi.fn(() => ({ operationId: 'reasoning-op' })),
  } as unknown as ChatStore;

  return new ClientLLMTransport({
    get: () => store,
    operationId: 'op-1',
    session: { assistantMessageId: 'msg-1' } as any,
  });
};

const input = {
  attempt: 1,
  context: {
    messages: [],
    modelParameters: { options: {}, params: {} },
    resolvedTools: { tools: [] },
  },
  events: [],
  maxAttempts: 3,
  model: 'gpt-5.6-sol',
  provider: 'lobehub',
  state: {},
} as any;

describe('ClientLLMTransport.runAttempt · empty-completion grounding guard', () => {
  beforeEach(() => {
    finishGrounding = grounding;
  });

  it('keeps a grounding-only completion (empty content, positive output tokens) as a success', async () => {
    finishGrounding = grounding;
    const result = await createTransport().runAttempt(input);

    expect(result.ok).toBe(true);
    expect(result.output.grounding).toEqual(grounding);
  });

  it('still flags a truly empty completion (no content, no grounding) as ModelEmptyError', async () => {
    finishGrounding = null;
    const result = await createTransport().runAttempt(input);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBeInstanceOf(ModelEmptyError);
    }
  });
});
