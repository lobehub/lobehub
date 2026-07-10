import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockDeviceFindByDeviceId,
  mockDeviceFindWorkspaceDeviceById,
  mockDispatchAgentRun,
  mockMessageCreate,
  mockResolveAttachmentsByFileIds,
  mockSpawnHeteroSandbox,
  mockIngestAttachment,
  mockPublishAgentRuntimeInit,
  mockPublishAgentRuntimeEnd,
} = vi.hoisted(() => ({
  mockDeviceFindByDeviceId: vi.fn(),
  mockDeviceFindWorkspaceDeviceById: vi.fn(),
  mockDispatchAgentRun: vi.fn().mockResolvedValue({ success: true }),
  mockIngestAttachment: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockPublishAgentRuntimeEnd: vi.fn().mockResolvedValue('end-event-id'),
  mockPublishAgentRuntimeInit: vi.fn().mockResolvedValue('init-event-id'),
  mockResolveAttachmentsByFileIds: vi.fn(),
  mockSpawnHeteroSandbox: vi.fn().mockResolvedValue(undefined),
}));

// Local hetero (claude-code / codex) now seeds publishAgentRuntimeInit so the
// agent-gateway DO reports `running` on a later reconnect. Stub the factory so
// the assertion below can verify the init, and so the real one (which probes
// Redis synchronously) doesn't throw a server-env error in the test env.
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: vi.fn(),
  createStreamEventManager: () => ({
    publishAgentRuntimeEnd: mockPublishAgentRuntimeEnd,
    publishAgentRuntimeInit: mockPublishAgentRuntimeInit,
  }),
  isRedisAvailable: vi.fn(() => false),
}));

const emptyResolvedAttachments = {
  fileList: [],
  imageList: [],
  orderedFileIds: [],
  videoList: [],
  warnings: [],
};

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../ingestAttachment', () => ({
  ingestAttachment: mockIngestAttachment,
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signOperationJwt: vi.fn().mockResolvedValue('op-jwt'),
  signUserJWT: vi.fn().mockResolvedValue('user-jwt'),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

const heteroAgentConfig = {
  agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
  chatConfig: {},
  files: [],
  id: 'agent-1',
  knowledgeBases: [],
  model: 'claude-code',
  plugins: [],
  provider: 'anthropic',
  systemRole: 'You are a helpful assistant',
};

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn().mockImplementation(() => ({
    findByDeviceId: mockDeviceFindByDeviceId,
    findWorkspaceDeviceById: mockDeviceFindWorkspaceDeviceById,
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    market: {
      creds: {
        get: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  })),
}));

vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(() => ({
    getHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/server/services/heterogeneousAgent/sandboxRunner', () => ({
  spawnHeteroSandbox: mockSpawnHeteroSandbox,
}));

vi.mock('@/server/services/file/resolveAttachments', () => ({
  resolveAttachmentsByFileIds: mockResolveAttachmentsByFileIds,
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    parseFile: vi.fn().mockResolvedValue({ content: '' }),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: vi.fn().mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    }),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    dispatchAgentRun: mockDispatchAgentRun,
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/server/services/heterogeneousAgent/remoteDeviceHeteroContext', () => ({
  buildRemoteDeviceHeteroContext: vi.fn().mockReturnValue('device context'),
}));

describe('AiAgentService.execAgent - hetero early-exit file attachments', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockSpawnHeteroSandbox.mockResolvedValue(undefined);
    mockDispatchAgentRun.mockResolvedValue({ success: true });
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockIngestAttachment.mockReset();
    heteroAgentConfig.agencyConfig = { heterogeneousProvider: { type: 'claude-code' } } as any;
    heteroAgentConfig.model = 'claude-code';
    heteroAgentConfig.provider = 'anthropic';

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const findUserMessageCreate = () =>
    mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');

  it('should attach fileIds to the user message (SPA gateway device/sandbox mode)', async () => {
    // regression: the hetero early exit used to create the user message
    // without `files`, so images attached in device mode were never linked
    // via messagesFiles and disappeared after the optimistic message was
    // replaced by the server snapshot.
    mockResolveAttachmentsByFileIds.mockResolvedValue({
      ...emptyResolvedAttachments,
      orderedFileIds: ['file-1', 'file-2'],
    });

    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-1', 'file-2'],
      prompt: 'Look at this image',
    });

    const userCall = findUserMessageCreate();
    expect(userCall).toBeDefined();
    expect(userCall![0].files).toEqual(['file-1', 'file-2']);
  });

  it('should attach the resolver-deduped fileIds (dedup lives in resolveAttachmentsByFileIds)', async () => {
    // resolveAttachmentsByFileIds dedupes internally and returns orderedFileIds;
    // execAgent attaches exactly what it returns (messagesFiles PK is fileId+messageId).
    mockResolveAttachmentsByFileIds.mockResolvedValue({
      ...emptyResolvedAttachments,
      orderedFileIds: ['file-1', 'file-2'],
    });

    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-1', 'file-1', 'file-2'],
      prompt: 'Look at this image',
    });

    expect(mockResolveAttachmentsByFileIds).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: ['file-1', 'file-1', 'file-2'] }),
    );
    const userCall = findUserMessageCreate();
    expect(userCall![0].files).toEqual(['file-1', 'file-2']);
  });

  it('should leave files undefined when no fileIds are provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'No attachments here',
    });

    const userCall = findUserMessageCreate();
    expect(userCall).toBeDefined();
    expect(userCall![0].files).toBeUndefined();
  });

  it('should leave files undefined when fileIds is an empty array', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      fileIds: [],
      prompt: 'No attachments here',
    });

    const userCall = findUserMessageCreate();
    expect(userCall![0].files).toBeUndefined();
  });

  it('should pass resolved Claude Code model and effort args to sandbox dispatch', async () => {
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      effort: 'high',
      model: 'opus',
      type: 'claude-code',
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use the selected Claude Code model',
    });

    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--model', 'opus', '--effort', 'high'],
      }),
    );
  });

  it('should pass resolved Codex model and reasoning effort args to sandbox dispatch', async () => {
    heteroAgentConfig.model = 'codex';
    heteroAgentConfig.provider = 'codex';
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      effort: 'xhigh',
      model: 'gpt-5.5',
      type: 'codex',
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use the selected Codex model',
    });

    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--model', 'gpt-5.5', '--effort', 'xhigh'],
      }),
    );
  });

  it('should encode native Codex args before forwarding them to sandbox lh hetero exec', async () => {
    heteroAgentConfig.model = 'codex';
    heteroAgentConfig.provider = 'codex';
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      args: ['-c', 'model = "gpt-5.4"'],
      effort: 'xhigh',
      model: 'gpt-5.5',
      type: 'codex',
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use existing native Codex args',
    });

    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--agent-arg=-c', '--agent-arg=model = "gpt-5.4"', '--effort', 'xhigh'],
      }),
    );
  });

  it('should pass resolved Claude Code model and effort args to device dispatch', async () => {
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        effort: 'high',
        model: 'opus',
        type: 'claude-code',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use the selected Claude Code model on device',
    });

    const dispatchParams = mockDispatchAgentRun.mock.calls[0][0];
    expect(dispatchParams).toEqual(expect.objectContaining({ deviceId: 'device-1' }));
    expect(dispatchParams.args).toEqual(['--model', 'opus', '--effort', 'high']);
  });

  describe('image delivery to the dispatched CLI', () => {
    it('should resolve image attachments and pass imageList to the sandbox dispatch', async () => {
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolvedAttachments,
        fileList: [
          {
            content: '',
            fileType: 'application/pdf',
            id: 'file-2',
            name: 'doc.pdf',
            size: 200,
            url: 'https://signed/file-2.pdf',
          },
        ],
        imageList: [{ alt: 'screenshot.png', id: 'file-1', url: 'https://signed/file-1.png' }],
        orderedFileIds: ['file-1', 'file-2'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-1', 'file-2'],
        prompt: 'Look at this image',
      });

      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          imageList: [{ id: 'file-1', url: 'https://signed/file-1.png' }],
        }),
      );
    });

    it('should pass imageList undefined when attachments contain no images', async () => {
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolvedAttachments,
        fileList: [
          {
            content: '',
            fileType: 'application/pdf',
            id: 'file-2',
            name: 'doc.pdf',
            size: 200,
            url: 'https://signed/file-2.pdf',
          },
        ],
        orderedFileIds: ['file-2'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-2'],
        prompt: 'Read this doc',
      });

      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ imageList: undefined }),
      );
    });

    it('should not block the run when attachment resolution fails', async () => {
      mockResolveAttachmentsByFileIds.mockRejectedValue(new Error('S3 down'));

      const result = await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-1'],
        prompt: 'Look at this image',
      });

      expect(result.success).toBe(true);
      // Persistence is independent of URL resolution — files still attached.
      const userCall = findUserMessageCreate();
      expect(userCall![0].files).toEqual(['file-1']);
      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ imageList: undefined }),
      );
    });

    it('should not resolve attachments when no fileIds are provided', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'No attachments here',
      });

      expect(mockResolveAttachmentsByFileIds).not.toHaveBeenCalled();
    });
  });

  describe('raw bot/IM file ingestion (files param)', () => {
    // regression: bot/IM channels deliver attachments as raw `files` buffers
    // (not pre-uploaded `fileIds`). The hetero branch returns before the main
    // ingestion block, so images sent through a bot were silently dropped and
    // the CLI received text only.
    it('should ingest raw files, attach them to the user message and forward images', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'uploaded-1',
        isImage: true,
        isVideo: false,
        resolvedUrl: 'https://signed/uploaded-1.png',
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [{ mimeType: 'image/png', name: 'shot.png', url: 'https://im/shot.png' }],
        prompt: 'What is this image?',
      });

      expect(mockIngestAttachment).toHaveBeenCalledTimes(1);

      const userCall = findUserMessageCreate();
      expect(userCall![0].files).toEqual(['uploaded-1']);

      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          imageList: [{ id: 'uploaded-1', url: 'https://signed/uploaded-1.png' }],
        }),
      );
    });

    it('should merge ingested files with pre-uploaded fileIds (both images forwarded)', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'uploaded-1',
        isImage: true,
        isVideo: false,
        resolvedUrl: 'https://signed/uploaded-1.png',
      });
      mockResolveAttachmentsByFileIds.mockResolvedValue({
        ...emptyResolvedAttachments,
        imageList: [{ alt: 'pre.jpg', id: 'file-1', url: 'https://signed/file-1.jpg' }],
        orderedFileIds: ['file-1'],
      });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-1'],
        files: [{ mimeType: 'image/png', name: 'shot.png', url: 'https://im/shot.png' }],
        prompt: 'Compare these images',
      });

      // Raw `files` are ingested first, then pre-uploaded `attachedFileIds`.
      const userCall = findUserMessageCreate();
      expect(userCall![0].files).toEqual(['uploaded-1', 'file-1']);

      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          imageList: [
            { id: 'uploaded-1', url: 'https://signed/uploaded-1.png' },
            { id: 'file-1', url: 'https://signed/file-1.jpg' },
          ],
        }),
      );
    });

    it('should not block the run when a raw file fails to ingest', async () => {
      mockIngestAttachment.mockRejectedValue(new Error('S3 down'));

      const result = await service.execAgent({
        agentId: 'agent-1',
        files: [{ mimeType: 'image/png', name: 'shot.png', url: 'https://im/shot.png' }],
        prompt: 'What is this image?',
      });

      expect(result.success).toBe(true);
      const userCall = findUserMessageCreate();
      expect(userCall![0].files).toBeUndefined();
      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ imageList: undefined }),
      );
    });
  });

  // The seed side of the hetero terminal-hook funnel. execAgent runs the hetero
  // block inline (process A) and serializes the run's lifecycle hooks onto
  // `topic.metadata.runningOperation.hooks` BEFORE the device/sandbox fork, so
  // the later heteroFinish callback (process B) can re-fire them across the
  // process boundary. If this seed drops the task-on-complete webhook, a finished
  // hetero task's `task_topics.status` stays stuck at `running` because
  // `onTopicComplete` never gets delivered. Guards that the passed hooks reach
  // runningOperation.hooks in serialized (webhook-only) form on BOTH dispatch
  // targets.
  describe('terminal hook seeding onto runningOperation (regression guard)', () => {
    const taskHook = {
      handler: async () => {},
      id: 'task-on-complete',
      type: 'onComplete' as const,
      webhook: {
        body: { taskId: 'task_x', taskIdentifier: 'T-X', userId: 'test-user-id' },
        delivery: 'qstash' as const,
        url: '/api/workflows/task/on-topic-complete',
      },
    };

    // Pick out the updateMetadata call that persists the running operation.
    const findRunningOpSeed = () =>
      topicMock.updateMetadata.mock.calls
        .map((call) => call[1])
        .find((patch: any) => patch?.runningOperation?.operationId);

    it('serializes the onComplete webhook hook onto runningOperation (sandbox dispatch)', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        hooks: [taskHook],
        prompt: 'do the task',
      } as any);

      // Sanity: this run took the sandbox path (no bound device).
      expect(mockSpawnHeteroSandbox).toHaveBeenCalled();

      const seed = findRunningOpSeed();
      expect(seed).toBeDefined();
      expect(seed.runningOperation.hooks).toEqual([
        expect.objectContaining({
          id: 'task-on-complete',
          type: 'onComplete',
          webhook: expect.objectContaining({
            delivery: 'qstash',
            url: '/api/workflows/task/on-topic-complete',
          }),
        }),
      ]);
      // The non-serializable handler must be stripped (only webhook crosses the
      // process boundary).
      expect(seed.runningOperation.hooks[0]).not.toHaveProperty('handler');
    });

    it('serializes the onComplete webhook hook onto runningOperation (device dispatch)', async () => {
      heteroAgentConfig.agencyConfig = {
        boundDeviceId: 'device-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      } as any;

      await service.execAgent({
        agentId: 'agent-1',
        hooks: [taskHook],
        prompt: 'do the task on device',
      } as any);

      // Sanity: this run took the device path.
      expect(mockDispatchAgentRun).toHaveBeenCalled();

      const seed = findRunningOpSeed();
      expect(seed).toBeDefined();
      expect(seed.runningOperation.hooks?.[0]?.id).toBe('task-on-complete');
      expect(seed.runningOperation.hooks?.[0]?.webhook?.url).toBe(
        '/api/workflows/task/on-topic-complete',
      );
    });

    // Regression guard for the "open the window and CC stops" bug: a device-
    // dispatched local hetero run must register the op with the agent-gateway DO
    // (publishAgentRuntimeInit) so a later reconnect resume reports `running`
    // instead of a terminal status that clears runningOperation and black-holes
    // the still-running agent's heteroIngest batches.
    it('seeds the gateway runtime init for a device-dispatched local hetero run', async () => {
      heteroAgentConfig.agencyConfig = {
        boundDeviceId: 'device-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      } as any;

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'do the task on device',
      } as any);

      expect(mockDispatchAgentRun).toHaveBeenCalled();
      expect(mockPublishAgentRuntimeInit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ heteroType: 'claude-code' }),
      );
    });

    it('seeds the gateway runtime init for a sandbox-dispatched local hetero run', async () => {
      heteroAgentConfig.agencyConfig = {
        heterogeneousProvider: { type: 'claude-code' },
      } as any;

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'do the task in the cloud sandbox',
      } as any);

      // Sanity: this run took the sandbox path.
      expect(mockSpawnHeteroSandbox).toHaveBeenCalled();
      expect(mockPublishAgentRuntimeInit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ heteroType: 'claude-code' }),
      );
    });
  });
});
