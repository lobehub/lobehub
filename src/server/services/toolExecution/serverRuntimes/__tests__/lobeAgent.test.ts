import { LobeAgentIdentifier, MAX_VISUAL_MEDIA_URLS } from '@lobechat/builtin-tool-lobe-agent';
import { createVisualFileRef } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mockToolsEnv = vi.hoisted(() => ({
  VISUAL_UNDERSTANDING_MODEL: undefined as string | undefined,
  VISUAL_UNDERSTANDING_PROVIDER: undefined as string | undefined,
}));
const mockMessageModelQueryByIds = vi.hoisted(() => vi.fn());
const mockMessageModelQuery = vi.hoisted(() => vi.fn());
const mockChat = vi.hoisted(() => vi.fn());
const mockInitModelRuntimeFromDB = vi.hoisted(() => vi.fn());
const mockConsumeStreamUntilDone = vi.hoisted(() => vi.fn());

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

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [
    {
      abilities: { video: true, vision: true },
      id: 'vision-model',
      providerId: 'test-provider',
    },
    {
      abilities: { video: false, vision: true },
      id: 'image-only-model',
      providerId: 'test-provider',
    },
  ],
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
    mockToolsEnv.VISUAL_UNDERSTANDING_MODEL = 'vision-model';
    mockToolsEnv.VISUAL_UNDERSTANDING_PROVIDER = 'test-provider';
    mockChat.mockImplementation(async (_payload, options) => {
      options?.callback?.onText?.('visual answer');
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

  it('should return a configuration error when visual model env is missing', async () => {
    mockToolsEnv.VISUAL_UNDERSTANDING_MODEL = undefined;
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('VISUAL_UNDERSTANDING_NOT_CONFIGURED');
  });

  it('should return an error when the source message has no visual files', async () => {
    mockMessageModelQueryByIds.mockResolvedValue([{ id: 'msg-1' }]);
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    expect(result).toMatchObject({
      error: { code: 'NO_VISUAL_FILES' },
      success: false,
    });
  });

  it('should validate requested visual file refs', async () => {
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        imageList: [{ alt: 'image.png', id: 'file-image', url: 'https://example.com/image.png' }],
        role: 'user',
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      refs: ['image_1'],
      question: 'what is this?',
    });

    const stableImageRef = createVisualFileRef({ index: 0, messageId: 'msg-1', type: 'image' });

    expect(result.success).toBe(false);
    expect(result.content).toContain(`Available refs: ${stableImageRef}`);
    expect(result.content).not.toContain(`Available refs: ${stableImageRef}, image_1`);
  });

  it('should require refs or urls', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({ question: 'what is this?' } as any);

    expect(result).toMatchObject({
      error: { code: 'INVALID_ARGUMENTS' },
      success: false,
    });
    expect(result.content).toContain('Either refs or urls is required');
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
  });

  it('should analyze direct media urls without querying message refs', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      question: 'what is this?',
      urls: ['https://example.com/generated.png'],
    });

    expect(result.success).toBe(true);
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
      expect.anything(),
    );
  });

  it('should reject unsupported direct media url protocols', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      question: 'what is this?',
      urls: [
        'data:text/plain;base64,abcd',
        'file:///private/image.png',
        'ftp://example.com/image.png',
      ],
    });

    expect(result).toMatchObject({
      error: { code: 'UNSUPPORTED_VISUAL_MEDIA_URLS' },
      success: false,
    });
    expect(result.content).toContain('Only http:, https:, data:image/* and data:video/* URLs');
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should reject too many direct media urls before querying message refs', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      question: 'what is this?',
      urls: Array.from(
        { length: MAX_VISUAL_MEDIA_URLS + 1 },
        (_, index) => `https://example.com/${index}.png`,
      ),
    });

    expect(result).toMatchObject({
      error: { code: 'UNSUPPORTED_VISUAL_MEDIA_URLS' },
      success: false,
    });
    expect(result.content).toContain(`At most ${MAX_VISUAL_MEDIA_URLS} URLs are supported`);
    expect(mockMessageModelQueryByIds).not.toHaveBeenCalled();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('should allow http and visual data direct media urls', async () => {
    const runtime = lobeAgentRuntime.factory(baseContext);

    const result = await runtime.analyzeVisualMedia({
      question: 'what is this?',
      urls: ['http://example.com/generated.png', 'data:image/png;base64,abcd'],
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
            ],
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it('should resolve stable refs from earlier topic messages', async () => {
    const previousImageRef = createVisualFileRef({
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

    const result = await runtime.analyzeVisualMedia({
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
    const previousImageRef = createVisualFileRef({
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

    const result = await runtime.analyzeVisualMedia({
      refs: [previousImageRef],
      question: 'what was in the earlier image?',
    });

    expect(result.success).toBe(true);
    expect(mockMessageModelQuery).toHaveBeenCalledWith(
      { threadId: 'thread-1', topicId: 'topic-1' },
      expect.objectContaining({ postProcessUrl: expect.any(Function) }),
    );
  });

  it('should not fall back to scoped visual messages when refs and urls are omitted', async () => {
    const runtime = lobeAgentRuntime.factory({ ...baseContext, topicId: 'topic-1' });

    const result = await runtime.analyzeVisualMedia({
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
      const result = await runtime.analyzeVisualMedia({
        refs: [createVisualFileRef({ index: 0, messageId: 'msg-previous', type: 'image' })],
        question: 'what was in the earlier image?',
      });

      expect(result.success).toBe(true);
      expect(mockMessageModelQuery).toHaveBeenCalledWith(
        expectedQuery,
        expect.objectContaining({ postProcessUrl: expect.any(Function) }),
      );
    }
  });

  it('should reject video files when the configured model lacks video support', async () => {
    mockToolsEnv.VISUAL_UNDERSTANDING_MODEL = 'image-only-model';
    mockMessageModelQueryByIds.mockResolvedValue([
      {
        id: 'msg-1',
        role: 'user',
        videoList: [{ alt: 'video.mp4', id: 'file-video', url: 'https://example.com/video.mp4' }],
      },
    ]);
    const runtime = lobeAgentRuntime.factory(baseContext);
    const stableVideoRef = createVisualFileRef({ index: 0, messageId: 'msg-1', type: 'video' });

    const result = await runtime.analyzeVisualMedia({
      refs: [stableVideoRef],
      question: 'what is in the video?',
    });

    expect(result).toMatchObject({
      error: { code: 'VISUAL_MODEL_VIDEO_UNSUPPORTED' },
      success: false,
    });
    expect(mockChat).not.toHaveBeenCalled();
  });
});
