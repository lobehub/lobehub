import { ModelEmptyError } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '../../store';
import { ClientLLMTransport } from './ClientLLMTransport';

// A grounding-only completion streams no text into `content`, but carries
// citation metadata and burns real output tokens. The stream (driven via
// `chatService.getChatCompletion`) finishes with `grounding` + `usage`, and the
// StreamingHandler surfaces the grounding as `metadata.search`.
const grounding = { citations: ['https://example.com'] } as any;
const usage = { cost: 5.980_015, totalOutputTokens: 25_220 } as any;

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

const createTransport = (context: Record<string, unknown> = {}) => {
  const operation = {
    abortController: new AbortController(),
    context: { agentId: 'agent-1', topicId: 'topic-1', ...context },
    status: 'running',
  };
  const store = {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    failOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    internal_transformToolCalls: vi.fn((calls: unknown) => calls),
    operations: { 'op-1': operation },
    startOperation: vi.fn(() => ({ operationId: 'reasoning-op' })),
    updateTopicStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatStore;

  return {
    store,
    transport: new ClientLLMTransport({
      get: () => store,
      operationId: 'op-1',
      session: { assistantMessageId: 'msg-1' } as any,
    }),
  };
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
    const result = await createTransport().transport.runAttempt(input);

    expect(result.ok).toBe(true);
    expect(result.output.grounding).toEqual(grounding);
  });

  it('still flags a truly empty completion (no content, no grounding) as ModelEmptyError', async () => {
    finishGrounding = null;
    const { transport } = createTransport();
    const result = await transport.runAttempt(input);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBeInstanceOf(ModelEmptyError);
      expect((result.error as ModelEmptyError).diagnostics).toMatchObject({ cost: 5.980_015 });
      expect(transport.retryPolicy.classifyError(result.error).kind).toBe('stop');
    }
  });
});

describe('ClientLLMTransport.retryPolicy.onError · terminal operation teardown', () => {
  it('writes the message error and fails the running operation immediately', () => {
    const { store, transport } = createTransport();

    transport.retryPolicy.onError?.({
      error: {
        body: {
          message: 'The content may contain prohibited content. Please adjust it and try again.',
          provider: 'google',
        },
        message: 'The content may contain prohibited content. Please adjust it and try again.',
        type: 'ProviderContentPolicyViolation',
      },
      events: [],
      interrupted: false,
    });

    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'msg-1',
        type: 'updateMessage',
        value: {
          error: expect.objectContaining({
            message: 'The content may contain prohibited content. Please adjust it and try again.',
            type: 'ProviderContentPolicyViolation',
          }),
        },
      },
      { operationId: 'op-1' },
    );
    expect(store.failOperation).toHaveBeenCalledWith('op-1', {
      message: 'The content may contain prohibited content. Please adjust it and try again.',
      type: 'ProviderContentPolicyViolation',
    });
    expect(store.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: undefined,
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('resets group-scoped topic status with the operation scope', () => {
    const { store, transport } = createTransport({
      groupId: 'group-1',
      scope: 'group',
    });

    transport.retryPolicy.onError?.({
      error: {
        message: 'The content may contain prohibited content. Please adjust it and try again.',
        type: 'ProviderContentPolicyViolation',
      },
      events: [],
      interrupted: false,
    });

    expect(store.updateTopicStatus).toHaveBeenCalledWith({
      agentId: 'agent-1',
      groupId: 'group-1',
      scope: 'group',
      status: 'active',
      topicId: 'topic-1',
    });
  });

  it('does not fail the operation when the run was interrupted by the user', () => {
    const { store, transport } = createTransport();

    transport.retryPolicy.onError?.({
      error: { message: 'aborted', type: 'AbortError' },
      events: [],
      interrupted: true,
    });

    expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
    expect(store.failOperation).not.toHaveBeenCalled();
    expect(store.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('does not fail an operation that is no longer running', () => {
    const { store, transport } = createTransport();
    store.operations['op-1'].status = 'cancelled';

    transport.retryPolicy.onError?.({
      error: {
        message: 'The content may contain prohibited content. Please adjust it and try again.',
        type: 'ProviderContentPolicyViolation',
      },
      events: [],
      interrupted: false,
    });

    expect(store.internal_dispatchMessage).toHaveBeenCalled();
    expect(store.failOperation).not.toHaveBeenCalled();
    expect(store.updateTopicStatus).not.toHaveBeenCalled();
  });

  it('does not reset topic status for nested sub-agent operations', () => {
    const { store, transport } = createTransport({ scope: 'sub_agent' });

    transport.retryPolicy.onError?.({
      error: {
        message: 'The content may contain prohibited content. Please adjust it and try again.',
        type: 'ProviderContentPolicyViolation',
      },
      events: [],
      interrupted: false,
    });

    expect(store.failOperation).toHaveBeenCalled();
    expect(store.updateTopicStatus).not.toHaveBeenCalled();
  });
});
