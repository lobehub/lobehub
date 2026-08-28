import { LobeAgentIdentifier, MAX_MEDIA_URLS } from '@lobechat/builtin-tool-lobe-agent';
import { createMediaFileRef } from '@lobechat/const/mediaRef';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mockToolsEnv = vi.hoisted(() => ({
  MULTIMODAL_UNDERSTANDING_MODEL: undefined as string | undefined,
  MULTIMODAL_UNDERSTANDING_PROVIDER: undefined as string | undefined,
}));
const mockMessageModelQueryByIds = vi.hoisted(() => vi.fn());
const mockMessageModelQuery = vi.hoisted(() => vi.fn());
const mockChat = vi.hoisted(() => vi.fn());
const mockInitModelRuntimeFromDB = vi.hoisted(() => vi.fn());
const mockConsumeStreamUntilDone = vi.hoisted(() => vi.fn());
const mockBuiltinModels = vi.hoisted(() => [
  {
    abilities: { audio: true, video: true, vision: true },
    id: 'vision-model',
    providerId: 'test-provider',
  },
  {
    abilities: { audio: true, video: false, vision: true },
    id: 'image-only-model',
    providerId: 'test-provider',
  },
  {
    abilities: { audio: false, video: true, vision: true },
    id: 'no-audio-model',
    providerId: 'test-provider',
  },
]);

vi.mock('@/envs/tools', () => ({
  toolsEnv: mockToolsEnv,
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    query: (...args: any[]) => mockMessageModelQuery(...args),
    queryByIds: (...args: any[]) => mockMessageModelQueryByIds(...args),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFullFileUrl: (path: string | null) => Promise.resolve(path || ''),
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: (...args: any[]) => mockInitModelRuntimeFromDB(...args),
}));

vi.mock('@lobechat/model-runtime', () => ({
  consumeStreamUntilDone: (...args: any[]) => mockConsumeStreamUntilDone(...args),
}));

vi.mock('@/business/client/model-bank/loadModels', () => ({
  loadModels: vi.fn().mockResolvedValue(mockBuiltinModels),
}));

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: mockBuiltinModels,
}));

// Plan documents are the todo runtime's optional mirror; a topic that never ran
// `createPlan` simply has none. Model that here so the todo tests exercise the
// message-history path the tool context is supposed to supply.
const mockFindPlanByTopic = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockUpdatePlanMetadata = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../lobeAgentPlan', () => ({
  createServerPlanRuntimeService: () => ({
    createPlan: vi.fn(),
    findPlanById: vi.fn(),
    findPlanByTopic: mockFindPlanByTopic,
    updatePlan: vi.fn(),
    updatePlanMetadata: mockUpdatePlanMetadata,
  }),
}));

const { lobeAgentRuntime } = await import('../lobeAgent');

describe('lobeAgentRuntime', () => {
  const baseContext: ToolExecutionContext = {
    messageId: 'msg-1',
    serverDB: {} as any,
    toolManifestMap: {},
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageModelQuery.mockResolvedValue([]);
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_MODEL = 'vision-model';
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_PROVIDER = 'test-provider';
    mockChat.mockImplementation(async (_payload, options) => {
      options?.callback?.onText?.('media answer');
      options?.callback?.onCompletion?.({ usage: { totalTokens: 12 } });
      return new Response('ok');
    });
    mockInitModelRuntimeFromDB.mockResolvedValue({ chat: mockChat });
    mockConsumeStreamUntilDone.mockResolvedValue(undefined);
  });

  it('should have the correct identifier', () => {
    expect(lobeAgentRuntime.identifier).toBe(LobeAgentIdentifier);
  });

  it('should require serverDB, userId and messageId', () => {
    expect(() => lobeAgentRuntime.factory({ toolManifestMap: {}, userId: 'user-1' })).toThrow(
      'serverDB is required for LobeAgent execution',
    );

    expect(() => lobeAgentRuntime.factory({ serverDB: {} as any, toolManifestMap: {} })).toThrow(
      'userId is required for LobeAgent execution',
    );

    expect(() =>
      lobeAgentRuntime.factory({
        serverDB: {} as any,
        toolManifestMap: {},
        userId: 'user-1',
      }),
    ).toThrow('messageId is required for LobeAgent execution');
  });

  it('should return a configuration error when multimodal model env is missing', async () => {
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_MODEL = undefined;
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('MULTIMODAL_UNDERSTANDING_NOT_CONFIGURED');
  });

  it('should return an error when the source message has no media files', async () => {
    mockMessageModelQueryByIds.mockResolvedValue([{ id: 'msg-1' }]);
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    expect(result).toMatchObject({
      error: { code: 'NO_MEDIA_FILES' },
      success: false,
    });
  });

  it('should validate requested media file refs', async () => {
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        imageList: [{ alt: 'image.png', id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    const stableImageRef = createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'image' });

    expect(result.success).toBe(false);
    expect(result.content).toContain(`Available refs: ${stableImageRef}`);
    expect(result.content).not.toContain(`Available refs: ${stableImageRef}, image_1`);
  });

  it('should require refs or urls', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({ question: 'what is this?' } as any);

    expect(result).toMatchObject({
      error: { code: 'INVALID_ARGUMENTS' },
      success: false,
    });
    expect(result.content).toContain('Either refs or urls is required');
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
  });

  it('should analyze direct media urls without querying message refs', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      question: 'what is this?',
      urls: ['https://example.com/generated.png'],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('media answer');
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(result.state).toMatchObject({
      files: [{ name: 'generated.png', ref: 'url_1', type: 'image' }],
    });
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: [
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({
                image_url: { detail: 'auto', url: 'https://example.com/generated.png' },
                type: 'image_url',
              }),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          trigger: RequestTrigger.MultimodalAnalysis,
        }),
      }),
    );
  });

  it('should pass workspaceId when initializing multimodal model runtime', async () => {
    const runtime = lobeAgentRuntime.factory({ ...baseContext, workspaceId: 'workspace-1' });

    await runtime.analyzeMedia({
      question: 'what is this?',
      urls: ['https://example.com/generated.png'],
    });

    expect(mockInitModelRuntimeFromDB).toHaveBeenCalledWith(
      baseContext.serverDB,
      'user-1',
      'test-provider',
      'workspace-1',
    );
  });

  it('should accumulate text content_part chunks from the multimodal model', async () => {
    mockChat.mockImplementationOnce(async (_payload, options) => {
      options?.callback?.onContentPart?.({
        content: 'media answer from content part',
        mimeType: 'text/plain',
        partType: 'text',
      });
      options?.callback?.onContentPart?.({
        content: 'base64-image-data',
        mimeType: 'image/png',
        partType: 'image',
      });
      options?.callback?.onCompletion?.({ usage: { totalTokens: 12 } });

      return new Response('ok');
    });
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      question: 'what is this?',
      urls: ['https://example.com/generated.png'],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('media answer from content part');
  });

  it('should reject unsupported direct media url protocols', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      question: 'what is this?',
      urls: [
        'data:text/plain;base64,abcd',
        'file:///private/image.png',
        'ftp://example.com/image.png',
      ],
    });

    expect(result).toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_URLS' },
      success: false,
    });
    expect(result.content).toContain(
      'Only http:, https:, data:audio/*, data:image/* and data:video/* URLs',
    );
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should reject too many direct media urls before querying message refs', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      question: 'what is this?',
      urls: Array.from(
        { length: MAX_MEDIA_URLS + 1 },
        (_, index) => `https://example.com/${index}.png`,
      ),
    });

    expect(result).toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_URLS' },
      success: false,
    });
    expect(result.content).toContain(`At most ${MAX_MEDIA_URLS} URLs are supported`);
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should allow http and multimodal data direct media urls', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeMedia({
      question: 'what is this?',
      urls: [
        'http://example.com/generated.png',
        'data:image/png;base64,abcd',
        'data:audio/mpeg;base64,abcd',
      ],
    });

    expect(result.success).toBe(true);
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: [
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({
                image_url: { detail: 'auto', url: 'http://example.com/generated.png' },
                type: 'image_url',
              }),
              expect.objectContaining({
                image_url: { detail: 'auto', url: 'data:image/png;base64,abcd' },
                type: 'image_url',
              }),
              expect.objectContaining({
                audio_url: { url: 'data:audio/mpeg;base64,abcd' },
                type: 'audio_url',
              }),
            ],
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it('should resolve stable refs from earlier topic messages', async () => {
    const previousImageRef = createMediaFileRef({
      index: 0,
      messageId: 'msg-previous',
      type: 'image',
    });
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        imageList: [
          { alt: 'current.png', id: 'file-current', url: 'https://example.com/current.png' },
        ],
        role: 'user',
      },
    ]);
    mockMessageModelQuery.mockResolvedValue([
      {
        id: 'msg-previous',
        imageList: [
          { alt: 'previous.png', id: 'file-previous', url: 'https://example.com/previous.png' },
        ],
        role: 'user',
      },
      {
        id: 'msg-1',
        imageList: [
          { alt: 'current.png', id: 'file-current', url: 'https://example.com/current.png' },
        ],
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory({ ...baseContext, topicId: 'topic-1' });

    const result = await runtime.analyzeMedia({
      refs: [previousImageRef],
      question: 'what was in the earlier image?',
    });

    expect(result.success).toBe(true);
    expect(mockMessageModelQuery).toHaveBeenCalledWith(
      { topicId: 'topic-1' },
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
    expect(result.state).toMatchObject({
      files: [{ id: 'file-previous', name: 'previous.png', ref: previousImageRef, type: 'image' }],
    });
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: [
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({
                image_url: { detail: 'auto', url: 'https://example.com/previous.png' },
                type: 'image_url',
              }),
            ],
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it('should use the source thread scope when resolving stable refs', async () => {
    const previousImageRef = createMediaFileRef({
      index: 0,
      messageId: 'msg-previous',
      type: 'image',
    });
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'user',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
    ]);
    mockMessageModelQuery.mockResolvedValue([
      {
        id: 'msg-previous',
        imageList: [
          { alt: 'previous.png', id: 'file-previous', url: 'https://example.com/previous.png' },
        ],
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory({ ...baseContext, topicId: 'topic-1' });

    const result = await runtime.analyzeMedia({
      refs: [previousImageRef],
      question: 'what was in the earlier image?',
    });

    expect(result.success).toBe(true);
    expect(mockMessageModelQuery).toHaveBeenCalledWith(
      { threadId: 'thread-1', topicId: 'topic-1' },
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
  });

  it('should not fall back to scoped media messages when refs and urls are omitted', async () => {
    const runtime = lobeAgentRuntime.factory({ ...baseContext, topicId: 'topic-1' });

    const result = await runtime.analyzeMedia({
      question: 'Does the person in the first image wear glasses?',
    } as any);

    expect(result).toMatchObject({
      error: { code: 'INVALID_ARGUMENTS' },
      success: false,
    });
    expect(mockMessageModelQuery).not.toHaveBeenCalled();
  });

  it('should use group, agent and legacy session scopes when resolving stable refs', async () => {
    const cases = [
      {
        expectedQuery: { groupId: 'group-1', topicId: 'topic-1' },
        sourceMessage: { groupId: 'group-1', id: 'msg-1', role: 'user', topicId: 'topic-1' },
      },
      {
        expectedQuery: { agentId: 'agent-1', topicId: 'topic-1' },
        sourceMessage: { agentId: 'agent-1', id: 'msg-1', role: 'user', topicId: 'topic-1' },
      },
      {
        expectedQuery: { sessionId: 'session-1', topicId: 'topic-1' },
        sourceMessage: { id: 'msg-1', role: 'user', sessionId: 'session-1', topicId: 'topic-1' },
      },
    ];

    for (const { expectedQuery, sourceMessage } of cases) {
      vi.clearAllMocks();
      mockMessageModelQueryByIds.mockResolvedValue([sourceMessage]);
      mockMessageModelQuery.mockResolvedValue([
        {
          id: 'msg-previous',
          imageList: [
            { alt: 'previous.png', id: 'file-previous', url: 'https://example.com/previous.png' },
          ],
          role: 'user',
        },
      ]);
      mockInitModelRuntimeFromDB.mockResolvedValue({ chat: mockChat });
      mockConsumeStreamUntilDone.mockResolvedValue(undefined);

      const runtime = lobeAgentRuntime.factory({ ...baseContext, topicId: 'topic-1' });
      const result = await runtime.analyzeMedia({
        refs: [createMediaFileRef({ index: 0, messageId: 'msg-previous', type: 'image' })],
        question: 'what was in the earlier image?',
      });

      expect(result.success).toBe(true);
      expect(mockMessageModelQuery).toHaveBeenCalledWith(
        expectedQuery,
        expect.objectContaining({ postProcessUrl: expect.any(Function) }),
      );
    }
  });

  it('should resolve audio refs and send audio content to the multimodal model', async () => {
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        audioList: [
          { alt: 'recording.mp3', id: 'file-audio', url: 'https://example.com/recording.mp3' },
        ],
        id: 'msg-1',
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);
    const stableAudioRef = createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'audio' });

    const result = await runtime.analyzeMedia({
      question: 'what is said in the audio?',
      refs: [stableAudioRef],
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      files: [{ id: 'file-audio', name: 'recording.mp3', ref: stableAudioRef, type: 'audio' }],
    });
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: [
              expect.objectContaining({ type: 'text' }),
              expect.objectContaining({
                audio_url: { url: 'https://example.com/recording.mp3' },
                type: 'audio_url',
              }),
            ],
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it('should reject audio files when the configured model lacks audio support', async () => {
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_MODEL = 'no-audio-model';
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        audioList: [
          { alt: 'recording.mp3', id: 'file-audio', url: 'https://example.com/recording.mp3' },
        ],
        id: 'msg-1',
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);
    const stableAudioRef = createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'audio' });

    const result = await runtime.analyzeMedia({
      question: 'what is said in the audio?',
      refs: [stableAudioRef],
    });

    expect(result).toMatchObject({
      error: { code: 'MULTIMODAL_MODEL_AUDIO_UNSUPPORTED' },
      success: false,
    });
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should reject video files when the configured model lacks video support', async () => {
    mockToolsEnv.MULTIMODAL_UNDERSTANDING_MODEL = 'image-only-model';
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'user',
        videoList: [{ alt: 'video.mp4', id: 'file-video', url: 'https://example.com/video.mp4' }],
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);
    const stableVideoRef = createMediaFileRef({ index: 0, messageId: 'msg-1', type: 'video' });

    const result = await runtime.analyzeMedia({
      refs: [stableVideoRef],
      question: 'what is in the video?',
    });

    expect(result).toMatchObject({
      error: { code: 'MULTIMODAL_MODEL_VIDEO_UNSUPPORTED' },
      success: false,
    });
    expect(mockChat).not.toHaveBeenCalled();
  });

  describe('callSubAgent', () => {
    it('rejects nested sub-agent execution without calling the injected runner', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);
      const run = vi.fn();

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer' },
        { ...baseContext, isSubAgent: true, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result.success).toBe(false);
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ error: { code: 'NESTED_SUB_AGENT_NOT_ALLOWED' } });
      expect(run).not.toHaveBeenCalled();
    });

    it('returns a deferred result and kicks off the sub-agent via the injected runner', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);
      const run = vi
        .fn()
        .mockResolvedValue({ started: true, subOperationId: 'sub-op-1', threadId: 'thread-1' });

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer', timeout: 1000 },
        { ...baseContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(run).toHaveBeenCalledWith({
        description: 'Research',
        instruction: 'Find the answer',
        timeout: 1000,
      });
      expect(result).toMatchObject({
        content: '',
        deferred: true,
        state: { status: 'pending', subOperationId: 'sub-op-1', threadId: 'thread-1' },
        success: true,
      });
    });

    it('returns a non-deferred error when the sub-agent fails to start', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);
      // Child op never started: no completion bridge will fire, so the parent
      // must not park — surface an inline tool error instead.
      const run = vi.fn().mockResolvedValue({ started: false, threadId: '' });

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer' },
        { ...baseContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result.success).toBe(false);
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ error: { code: 'SUB_AGENT_START_FAILED' } });
    });

    it('surfaces the underlying reason when the sub-agent fails to start', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);
      const run = vi
        .fn()
        .mockResolvedValue({ error: 'QStash queue unavailable', started: false, threadId: '' });

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer' },
        { ...baseContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe('Sub-agent failed to start: QStash queue unavailable');
      expect(result).toMatchObject({ error: { code: 'SUB_AGENT_START_FAILED' } });
    });

    it('fails (not deferred) when no sub-agent runner is available', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer' },
        baseContext,
      );

      expect(result.success).toBe(false);
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ error: { code: 'SUB_AGENT_UNAVAILABLE' } });
    });

    it('fails when instruction is missing', async () => {
      const runtime = lobeAgentRuntime.factory(baseContext);
      const run = vi.fn();

      const result = await runtime.callSubAgent(
        { description: 'Research' } as any,
        { ...baseContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result.success).toBe(false);
      expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' } });
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('todos', () => {
    const todoContext: ToolExecutionContext = {
      ...baseContext,
      currentTodos: [
        { status: 'completed', text: 'env setup' },
        { status: 'todo', text: 'run case 1' },
        { status: 'todo', text: 'write report' },
      ],
      topicId: 'topic-1',
    };

    it('applies operations against ctx.currentTodos when no plan document exists', async () => {
      // Regression: the runtime used to drop `ctx` and resolve todos from the
      // plan document alone. With no document the list came back empty, every
      // index went out of bounds, and the agent got "No operations applied."
      // plus an empty list — which then overwrote the message-history copy.
      const runtime = lobeAgentRuntime.factory(todoContext);

      const result = await runtime.updateTodos(
        { operations: [{ index: 1, type: 'processing' }] },
        todoContext,
      );

      expect(result.content).not.toContain('No operations applied.');
      expect(result.state.todos.items).toHaveLength(3);
      expect(result.state.todos.items[1].status).toBe('processing');
    });

    it('appends to ctx.currentTodos instead of restarting the list', async () => {
      const runtime = lobeAgentRuntime.factory(todoContext);

      const result = await runtime.createTodos({ adds: ['publish report'] }, todoContext);

      expect(result.state.todos.items).toHaveLength(4);
      expect(result.state.todos.items[3].text).toBe('publish report');
    });
  });
});
