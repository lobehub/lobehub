import type { AgentEvent, BlobStore } from '@lobechat/agent-runtime';
import { ToolNameResolver } from '@lobechat/context-engine';
import type { ChatMethodOptions, ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { createServerCallLlmAttempt } from './serverCallLlmAttempt';
import type { ServerCallLlmTooling } from './serverCallLlmTooling';

const recordModelCompletionFailureMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/model-runtime', async () => {
  const { isEmptyModelCompletion, ModelEmptyError } =
    await import('../../../../../../packages/model-runtime/src/errors/modelEmptyCompletion');
  const { ModelRefusalError } =
    await import('../../../../../../packages/model-runtime/src/errors/modelRefusal');
  const { consumeStreamUntilDone } =
    await import('../../../../../../packages/model-runtime/src/utils/consumeStream');

  return {
    consumeStreamUntilDone,
    isEmptyModelCompletion,
    ModelEmptyError,
    ModelRefusalError,
  };
});

vi.mock('@/business/server/recordModelCompletionFailure', () => ({
  recordModelCompletionFailure: recordModelCompletionFailureMock,
}));

vi.mock('@/envs/file', () => ({
  fileEnv: { NEXT_PUBLIC_S3_FILE_PATH: 'files' },
}));

const toolName = new ToolNameResolver().generate('workspace', 'search', 'builtin');
const resolved = {
  enabledToolIds: ['workspace'],
  executorMap: { workspace: 'server' },
  manifestMap: {},
  promptManifestMap: {},
  sourceMap: { workspace: 'builtin' },
  tools: [
    {
      function: {
        description: 'Search the workspace',
        name: toolName,
        parameters: { type: 'object' },
      },
      type: 'function',
    },
  ],
} as ServerCallLlmTooling['resolved'];

const createAttempt = (
  runCallbacks: (options: ChatMethodOptions) => Promise<void>,
  blobStore?: BlobStore,
  attemptOverrides?: {
    clientIp?: string;
    agentShareVisitorIds?: { agentId: string; shareId: string; visitorUserId: string };
    userAgent?: string;
  },
) => {
  const publishStreamChunk = vi.fn().mockResolvedValue('event-1');
  const streamManager = {
    publishStreamChunk,
    publishStreamEvent: vi.fn().mockResolvedValue('event-2'),
  } as unknown as RuntimeExecutorContext['streamManager'];
  const ctx = {
    messageModel: {} as RuntimeExecutorContext['messageModel'],
    operationId: 'operation-1',
    serverDB: {} as RuntimeExecutorContext['serverDB'],
    stepIndex: 2,
    streamManager,
    toolExecutionService: {} as RuntimeExecutorContext['toolExecutionService'],
    userId: 'user-1',
  } satisfies RuntimeExecutorContext;
  const chat = vi.fn(async (_payload, options?: ChatMethodOptions) => {
    await runCallbacks(options!);
    return new Response('done');
  });
  const events: AgentEvent[] = [];
  const onFirstChunk = vi.fn();
  const attempt = createServerCallLlmAttempt({
    attempt: 1,
    blobStore,
    chatPayload: {
      messages: [{ content: 'Question', role: 'user' }],
      model: 'test-model',
      stream: true,
      tools: resolved.tools,
    },
    ctx,
    events,
    maxAttempts: 3,
    messageCount: 1,
    model: 'test-model',
    modelRuntime: { chat } as unknown as Pick<ModelRuntime, 'chat'>,
    onFirstChunk,
    operationLogId: 'operation-1:2',
    provider: 'test-provider',
    resolved,
    topicId: 'topic-1',
    trigger: 'user',
    ...attemptOverrides,
  });

  return { attempt, chat, events, onFirstChunk, publishStreamChunk };
};

describe('ServerCallLlmAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects callback output and exposes a completed attempt snapshot', async () => {
    const rawToolCall = {
      function: { arguments: '{"query":"docs"}', name: toolName },
      id: 'call-1',
      type: 'function' as const,
    };
    const { attempt, events, onFirstChunk, publishStreamChunk } = createAttempt(
      async ({ callback }) => {
        await callback?.onText?.('Visible answer');
        await callback?.onThinking?.('Reasoning');
        await callback?.onGrounding?.({ searchQueries: ['docs'] });
        await callback?.onToolsCalling?.({ chunk: [], toolsCalling: [rawToolCall] });
        await callback?.onCompletion?.({
          finishReason: 'tool_use',
          reasoning: { content: 'Reasoning', signature: 'encrypted-signature' },
          speed: { tps: 20, ttft: 100 },
          text: '',
          usage: { totalInputTokens: 10, totalOutputTokens: 5, totalTokens: 15 },
        });
      },
    );

    await attempt.execute();

    const snapshot = attempt.snapshot();

    expect(snapshot.content).toBe('Visible answer');
    expect(snapshot.thinkingContent).toBe('Reasoning');
    expect(snapshot.grounding).toEqual({ searchQueries: ['docs'] });
    expect(snapshot.reasoning).toEqual({
      content: 'Reasoning',
      signature: 'encrypted-signature',
    });
    expect(snapshot.finishReason).toBe('tool_use');
    expect(snapshot.speed).toEqual({ tps: 20, ttft: 100 });
    expect(snapshot.usage).toEqual({
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
    });
    expect(snapshot.toolCalls).toEqual([rawToolCall]);
    expect(snapshot.toolsCalling).toEqual([
      expect.objectContaining({
        apiName: 'search',
        executor: 'server',
        id: 'call-1',
        identifier: 'workspace',
        source: 'builtin',
      }),
    ]);
    expect(onFirstChunk).toHaveBeenCalledTimes(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunk: { text: 'Visible answer', type: 'text' } }),
        expect.objectContaining({ chunk: { text: 'Reasoning', type: 'reasoning' } }),
      ]),
    );
    expect(publishStreamChunk).toHaveBeenCalledWith(
      'operation-1',
      2,
      expect.objectContaining({ chunkType: 'tools_calling' }),
    );
  });

  it('forwards clientIp / userAgent into the chat call metadata when provided', async () => {
    const { attempt, chat } = createAttempt(
      async ({ callback }) => {
        await callback?.onText?.('Answer');
        await callback?.onCompletion?.({ text: '', usage: { totalOutputTokens: 1 } });
      },
      undefined,
      { clientIp: '203.0.113.7', userAgent: 'Mozilla/5.0 (Test)' },
    );

    await attempt.execute();

    expect(chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientIp: '203.0.113.7',
          operationId: 'operation-1',
          topicId: 'topic-1',
          trigger: 'user',
          userAgent: 'Mozilla/5.0 (Test)',
        }),
      }),
    );
  });

  // A share run is billed to the CREATOR's account, so without this the spend
  // row is indistinguishable from the creator's own usage.
  it('forwards share attribution into the chat call metadata', async () => {
    const { attempt, chat } = createAttempt(
      async ({ callback }) => {
        await callback?.onText?.('Answer');
        await callback?.onCompletion?.({ text: '', usage: { totalOutputTokens: 1 } });
      },
      undefined,
      {
        agentShareVisitorIds: {
          agentId: 'agt_shared',
          shareId: 'share-1',
          visitorUserId: 'visitor-1',
        },
      },
    );

    await attempt.execute();

    expect(chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          agentShare: { agentId: 'agt_shared', shareId: 'share-1', visitorUserId: 'visitor-1' },
        }),
      }),
    );
  });

  it('leaves clientIp / userAgent metadata undefined when not provided', async () => {
    const { attempt, chat } = createAttempt(async ({ callback }) => {
      await callback?.onText?.('Answer');
      await callback?.onCompletion?.({ text: '', usage: { totalOutputTokens: 1 } });
    });

    await attempt.execute();

    const metadata = chat.mock.calls[0][1]!.metadata as Record<string, unknown>;
    expect(metadata.clientIp).toBeUndefined();
    expect(metadata.userAgent).toBeUndefined();
  });

  it('keeps partial output and usage readable after a stream error', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onText?.('Partial answer');
      await callback?.onCompletion?.({
        text: '',
        usage: { totalOutputTokens: 3 },
      });
      await callback?.onError?.({
        errorType: 'ProviderBizError',
        message: 'provider stream failed',
        status: 503,
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      errorType: 'ProviderBizError',
      message: 'LLM stream error: provider stream failed',
      status: 503,
    });
    attempt.clearBuffers();

    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        content: 'Partial answer',
        usage: { totalOutputTokens: 3 },
      }),
    );
  });

  it('salvages a natural-stop answer emitted only in reasoning', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onThinking?.('Final answer from reasoning');
      await callback?.onCompletion?.({
        finishReason: 'stop',
        text: '',
        usage: { totalOutputTokens: 5 },
      });
    });

    await attempt.execute();

    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        answerSalvagedFromReasoning: true,
        content: 'Final answer from reasoning',
        thinkingContent: '',
      }),
    );
  });

  it('persists generated images through BlobStore and snapshots the resolved URL', async () => {
    const blobStore: BlobStore = {
      persistBase64: vi.fn().mockResolvedValue({
        fileId: 'file-1',
        key: 'files/generations/image.png',
        url: 'https://files.example/image.png',
      }),
      resolveUrl: vi.fn(),
    };
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onContentPart?.({ content: 'Generated image:', partType: 'text' });
      await callback?.onContentPart?.({
        content: 'BASE64_IMAGE',
        mimeType: 'image/png',
        partType: 'image',
      });
      await callback?.onCompletion?.({
        text: '',
        usage: { totalOutputTokens: 1 },
      });
    }, blobStore);

    await attempt.execute();

    expect(blobStore.persistBase64).toHaveBeenCalledWith(
      'BASE64_IMAGE',
      expect.stringMatching(/files\/generations\/.+\.png$/),
    );
    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        contentParts: [
          { text: 'Generated image:', type: 'text' },
          { image: 'https://files.example/image.png', type: 'image' },
        ],
        hasContentImages: true,
      }),
    );
  });

  it('accepts an image-only multimodal completion as non-empty', async () => {
    const blobStore: BlobStore = {
      persistBase64: vi.fn().mockResolvedValue({
        fileId: 'file-1',
        key: 'files/generations/image.png',
        url: 'https://files.example/image.png',
      }),
      resolveUrl: vi.fn(),
    };
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onContentPart?.({
        content: 'BASE64_IMAGE',
        mimeType: 'image/png',
        partType: 'image',
      });
      await callback?.onCompletion?.({
        finishReason: 'stop',
        text: '',
        usage: { outputImageTokens: 1120, totalOutputTokens: 1120 },
      });
    }, blobStore);

    await expect(attempt.execute()).resolves.toBeUndefined();
    expect(attempt.snapshot()).toEqual(
      expect.objectContaining({
        content: '',
        contentParts: [{ image: 'https://files.example/image.png', type: 'image' }],
        hasContentImages: true,
      }),
    );
  });

  it('classifies an empty refusal separately and records complete normalized evidence', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onContentPart?.({
        content: '',
        partType: 'text',
        thoughtSignature: 'content-thought-signature',
      });
      await callback?.onReasoningPart?.({
        content: '',
        partType: 'text',
        thoughtSignature: 'reasoning-thought-signature',
      });
      await callback?.onCompletion?.({
        finishReason: 'refusal',
        reasoning: { content: '', signature: 'reasoning-signature' },
        text: '',
        usage: { totalInputTokens: 10, totalOutputTokens: 0, totalTokens: 10 },
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      errorType: 'ModelRefusal',
      message: 'The model declined to answer this request.',
    });
    expect(recordModelCompletionFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 3,
        model: 'test-model',
        operationId: 'operation-1',
        operationLogId: 'operation-1:2',
        provider: 'test-provider',
        reason: 'refusal',
        request: expect.objectContaining({
          messages: [{ content: 'Question', role: 'user' }],
        }),
        response: {
          base64ImageEvents: [],
          completion: expect.objectContaining({
            finishReason: 'refusal',
            reasoning: { content: '', signature: 'reasoning-signature' },
          }),
          contentPartEvents: [
            {
              content: '',
              partType: 'text',
              thoughtSignature: 'content-thought-signature',
            },
          ],
          output: expect.objectContaining({
            finishReason: 'refusal',
            reasoning: { content: '', signature: 'reasoning-signature' },
          }),
          reasoningPartEvents: [
            {
              content: '',
              partType: 'text',
              thoughtSignature: 'reasoning-thought-signature',
            },
          ],
        },
        stepIndex: 2,
        topicId: 'topic-1',
        trigger: 'user',
        userId: 'user-1',
      }),
    );
  });

  it('keeps a refusal with visible provider text as a normal completion', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onText?.('I cannot help with that request.');
      await callback?.onCompletion?.({
        finishReason: 'refusal',
        text: 'I cannot help with that request.',
        usage: { totalOutputTokens: 8 },
      });
    });

    await expect(attempt.execute()).resolves.toBeUndefined();
    expect(attempt.snapshot().content).toBe('I cannot help with that request.');
    expect(recordModelCompletionFailureMock).not.toHaveBeenCalled();
  });

  it('classifies a refusal with only hidden reasoning as ModelRefusal', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onThinking?.('Internal refusal analysis');
      await callback?.onCompletion?.({
        finishReason: 'refusal',
        reasoning: { content: 'Internal refusal analysis', signature: 'reasoning-signature' },
        text: '',
        usage: { totalOutputTokens: 12 },
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      diagnostics: expect.objectContaining({ reasoningLength: 25 }),
      errorType: 'ModelRefusal',
    });
    expect(recordModelCompletionFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'refusal' }),
    );
  });

  it('records an unexplained blank completion before throwing ModelEmptyError', async () => {
    const { attempt } = createAttempt(async ({ callback }) => {
      await callback?.onCompletion?.({
        finishReason: 'stop',
        text: '',
        usage: { totalInputTokens: 5, totalOutputTokens: 0, totalTokens: 5 },
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      errorType: 'ModelEmptyCompletion',
      message: 'The model provider returned an empty completion.',
    });
    expect(recordModelCompletionFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'empty_completion',
        response: expect.objectContaining({
          completion: expect.objectContaining({ finishReason: 'stop' }),
          output: expect.objectContaining({ finishReason: 'stop' }),
        }),
      }),
    );
  });

  it('records route and provider-boundary evidence with an empty completion', async () => {
    const rawResponseBody = 'data: {"type":"message_delta"}\n\ndata: {"type":"message_stop"}\n\n';
    const providerEvidence = {
      providerRequest: {
        apiMode: 'messages',
        payload: { messages: [{ content: 'Final provider prompt', role: 'user' }] },
        sentAt: 100,
      },
      providerResponse: {
        eventCount: 5,
        hasNonWhitespaceText: false,
        hasNonWhitespaceThinking: false,
        rawEvents: [
          { delta: { stop_reason: 'end_turn' }, type: 'message_delta' },
          { type: 'message_stop' },
        ],
        rawResponse: {
          body: rawResponseBody,
          byteLength: new TextEncoder().encode(rawResponseBody).byteLength,
          status: 'captured',
        },
        requestId: 'request-1',
        status: 200,
        stopReason: 'end_turn',
        thinkingChars: 1,
      },
    };
    const routeEvidence = {
      apiType: 'deepseek',
      channelId: 'deepseek',
      optionIndex: 0,
      providerId: 'lobehub',
      routerId: 'deepseek',
      success: true,
      totalOptions: 3,
    };
    const { attempt } = createAttempt(async ({ callback, diagnostics, metadata }) => {
      Object.assign(diagnostics!, providerEvidence);
      metadata!.routeAttempt = routeEvidence;
      await callback?.onThinking?.(' ');
      await callback?.onCompletion?.({
        finishReason: 'end_turn',
        text: '',
        usage: { totalInputTokens: 206_384, totalOutputTokens: 1, totalTokens: 206_385 },
      });
    });

    await expect(attempt.execute()).rejects.toMatchObject({
      errorType: 'ModelEmptyCompletion',
    });
    expect(recordModelCompletionFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: {
          provider: providerEvidence,
          route: routeEvidence,
        },
      }),
    );
  });
});
