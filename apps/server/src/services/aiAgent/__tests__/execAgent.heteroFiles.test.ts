import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { AiAgentService } from '../index';

const {
  mockDeviceFindByDeviceId,
  mockDeviceFindWorkspaceDeviceById,
  mockBuildRemoteDeviceHeteroContext,
  mockCreateOperationMetadata,
  mockDispatchAgentRun,
  mockExecuteToolCall,
  mockGetHeterogeneousResumeSessionId,
  mockMessageCreate,
  mockMessageQuery,
  mockResolveAttachmentsByFileIds,
  mockSpawnHeteroSandbox,
  mockIngestAttachment,
  mockPublishAgentRuntimeInit,
  mockPublishAgentRuntimeEnd,
} = vi.hoisted(() => ({
  mockBuildRemoteDeviceHeteroContext: vi.fn().mockReturnValue('device context'),
  mockCreateOperationMetadata: vi.fn().mockResolvedValue(undefined),
  mockDeviceFindByDeviceId: vi.fn(),
  mockDeviceFindWorkspaceDeviceById: vi.fn(),
  mockDispatchAgentRun: vi.fn().mockResolvedValue({ success: true }),
  mockExecuteToolCall: vi.fn().mockResolvedValue({ success: true }),
  mockGetHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined),
  mockIngestAttachment: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
  mockPublishAgentRuntimeEnd: vi.fn().mockResolvedValue('end-event-id'),
  mockPublishAgentRuntimeInit: vi.fn().mockResolvedValue('init-event-id'),
  mockResolveAttachmentsByFileIds: vi.fn(),
  mockSpawnHeteroSandbox: vi.fn().mockResolvedValue(undefined),
}));

// Local hetero (claude-code / codebuddy / codex / cursor / opencode / pi / qoder) seeds
// publishAgentRuntimeInit so the agent-gateway DO reports `running` on a later reconnect. Stub the factory so
// the assertion below can verify the init, and so the real one (which probes
// Redis synchronously) doesn't throw a server-env error in the test env.
vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createAgentStateManager: vi.fn(() => ({
    createOperationMetadata: mockCreateOperationMetadata,
  })),
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
  signHeteroOperationJWT: vi.fn().mockResolvedValue('op-jwt'),
  signUserJWT: vi.fn().mockResolvedValue('user-jwt'),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: mockMessageQuery,
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
  appendRunningOperationChild: vi.fn().mockResolvedValue(true),
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
  tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
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
    getHeterogeneousResumeSessionId: mockGetHeterogeneousResumeSessionId,
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
    interruptOperation: vi.fn().mockResolvedValue(true),
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
    executeToolCall: mockExecuteToolCall,
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
    resolveDeviceWorkspaceId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/server/services/heterogeneousAgent/remoteDeviceHeteroContext', () => ({
  buildRemoteDeviceHeteroContext: mockBuildRemoteDeviceHeteroContext,
}));

describe('AiAgentService.execAgent - hetero early-exit file attachments', () => {
  let service: AiAgentService;
  let recordStartSpy: MockInstance<CompletionLifecycle['recordStart']>;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    recordStartSpy = vi.spyOn(CompletionLifecycle.prototype, 'recordStart').mockResolvedValue(true);
    topicMock.appendRunningOperationChild.mockResolvedValue(true);
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.releaseTaskCallbackReservation.mockResolvedValue(undefined);
    topicMock.tryReserveTaskCallback.mockResolvedValue(true);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockMessageQuery.mockResolvedValue([]);
    mockResolveAttachmentsByFileIds.mockResolvedValue({ ...emptyResolvedAttachments });
    mockSpawnHeteroSandbox.mockResolvedValue(undefined);
    mockDispatchAgentRun.mockResolvedValue({ success: true });
    mockExecuteToolCall.mockResolvedValue({ success: true });
    mockGetHeterogeneousResumeSessionId.mockResolvedValue(undefined);
    mockMessageQuery.mockResolvedValue([]);
    mockBuildRemoteDeviceHeteroContext.mockImplementation(({ conversationHistory }) =>
      conversationHistory ? 'device recovery context' : 'device context',
    );
    mockDeviceFindByDeviceId.mockResolvedValue({ defaultCwd: '/Users/alice/repo' });
    mockDeviceFindWorkspaceDeviceById.mockResolvedValue(undefined);
    mockCreateOperationMetadata.mockResolvedValue(undefined);
    mockIngestAttachment.mockReset();
    heteroAgentConfig.agencyConfig = { heterogeneousProvider: { type: 'claude-code' } } as any;
    heteroAgentConfig.model = 'claude-code';
    heteroAgentConfig.provider = 'anthropic';
    delete (heteroAgentConfig as any).userId;
    delete (heteroAgentConfig as any).visibility;
    delete (heteroAgentConfig as any).workspaceId;

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    recordStartSpy.mockRestore();
    vi.clearAllMocks();
  });

  const findUserMessageCreate = () =>
    mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');

  it('does not dispatch a heterogeneous run when its durable operation row fails', async () => {
    recordStartSpy.mockResolvedValueOnce(false);

    await expect(
      service.execAgent({ agentId: 'agent-1', prompt: 'Run the build' }),
    ).rejects.toThrow('Failed to persist heterogeneous agent operation');

    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  /**
   * @example Operation B cannot reserve the topic until operation A's interrupt resolves.
   */
  it('waits for the replaced operation to stop before reserving the replacement', async () => {
    // ROOT CAUSE:
    //
    // The old marker was atomically replaced without waiting for the device
    // process behind it. That let operation B resume while operation A still
    // owned the native Codex thread writer.
    //
    // Before: tryReserveTaskCallback ran immediately for the replacement.
    // After: interruptTask settles the old physical run before reservation.
    let releaseInterrupt: (() => void) | undefined;
    const interruptSpy = vi.spyOn(service, 'interruptTask').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseInterrupt = () => resolve({ operationId: 'op-old', success: true });
        }),
    );

    const replacement = service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'replacement turn',
      replacesOperationId: 'op-old',
    } as any);
    await vi.waitFor(() => expect(interruptSpy).toHaveBeenCalledOnce());

    expect(topicMock.tryReserveTaskCallback).not.toHaveBeenCalled();

    releaseInterrupt?.();
    await replacement;

    expect(topicMock.tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', expect.any(String), {
      allowRunningOperationId: undefined,
      allowSameReservationReentry: true,
      ignoreRunningOperation: undefined,
      replacesOperationId: 'op-old',
    });
  });

  /**
   * @example Operation B is rejected when operation A's device process remains alive.
   */
  it('does not reserve a replacement when device cancellation is unconfirmed', async () => {
    // ROOT CAUSE:
    //
    // Device Gateway reports transport success separately from the cancellation
    // payload. Ignoring `state.exited` allowed a replacement to resume while the
    // previous native process could still own the Codex thread writer.
    //
    // Before: every resolved interrupt allowed topic reservation.
    // After: an explicitly unconfirmed device cancellation rejects replacement.
    vi.spyOn(service, 'interruptTask').mockResolvedValue({
      deviceCancellationConfirmed: false,
      operationId: 'op-old',
      success: true,
    });

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        prompt: 'replacement turn',
        replacesOperationId: 'op-old',
      } as any),
    ).rejects.toThrow('Replaced heterogeneous agent process did not confirm termination');

    expect(topicMock.tryReserveTaskCallback).not.toHaveBeenCalled();
  });

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

  it('should pin the CLI default selection and runtime type on a server-created topic', async () => {
    await service.execAgent({ agentId: 'agent-1', prompt: 'Run the build' });

    expect(topicMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'default', provider: 'claude-code' }),
      undefined,
    );
  });

  it('should snapshot and execute a selected heterogeneous model on a server-created topic', async () => {
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      model: 'opus',
      type: 'claude-code',
    } as any;

    await service.execAgent({ agentId: 'agent-1', prompt: 'Run with Opus' });

    expect(topicMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'opus', provider: 'claude-code' }),
      undefined,
    );
    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--model', 'opus'] }),
    );
  });

  it('should execute an existing topic with its pinned heterogeneous model', async () => {
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      args: ['--model', 'stale-arg-model'],
      model: 'agent-model',
      type: 'claude-code',
    } as any;
    topicMock.findById.mockResolvedValue({
      id: 'topic-existing',
      metadata: undefined,
      model: 'topic-model',
      provider: 'claude-code',
    });

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-existing' },
      prompt: 'Continue with the topic model',
    } as any);

    expect(topicMock.create).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--model', 'topic-model'] }),
    );
  });

  it('should pin the runtime type of a remote platform agent on a server-created topic', async () => {
    heteroAgentConfig.agencyConfig = { heterogeneousProvider: { type: 'openclaw' } } as any;
    heteroAgentConfig.provider = 'lobehub';

    await service.execAgent({ agentId: 'agent-1', prompt: 'Run the build' });

    expect(topicMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: undefined, provider: 'openclaw' }),
      undefined,
    );
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

  it('should pass the resolved Amp mode to device dispatch', async () => {
    heteroAgentConfig.model = 'amp';
    heteroAgentConfig.provider = 'amp';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        mode: 'high',
        type: 'amp',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use Amp high mode',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'amp',
        args: ['--agent-arg=--mode', '--agent-arg=high'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('resumes Amp natively without loading or injecting fallback history', async () => {
    mockGetHeterogeneousResumeSessionId.mockResolvedValue('amp-thread-existing');
    heteroAgentConfig.model = 'amp';
    heteroAgentConfig.provider = 'amp';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'amp' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Continue the Amp thread',
    });

    expect(mockMessageQuery).not.toHaveBeenCalled();
    expect(mockBuildRemoteDeviceHeteroContext).toHaveBeenCalledOnce();
    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeFallbackSystemContext: undefined,
        resumeSessionId: 'amp-thread-existing',
        systemContext: 'device context',
      }),
    );
  });

  it('should pass resolved Claude Code model and effort args to sandbox dispatch', async () => {
    heteroAgentConfig.agencyConfig.heterogeneousProvider = {
      effort: 'high',
      model: 'opus',
      type: 'claude-code',
    } as any;

    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use the selected Claude Code model',
    });

    expect(result.heteroType).toBe('claude-code');
    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--model', 'opus', '--effort', 'high'],
      }),
    );
    expect(topicMock.updateMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        runningOperation: expect.objectContaining({ heteroType: 'claude-code' }),
      }),
    );
  });

  it.each(['claude-code', 'codex'] as const)(
    'should reject %s provider binding before sandbox or device dispatch',
    async (type) => {
      heteroAgentConfig.agencyConfig = {
        executionTarget: 'sandbox',
        heterogeneousProvider: {
          apiConfig: {
            model: type === 'codex' ? 'gpt-test' : 'claude-test',
            providerId: type === 'codex' ? 'openai' : 'anthropic',
          },
          authMode: 'api',
          type,
        },
      } as any;

      const result = await service.execAgent({
        agentId: 'agent-1',
        prompt: 'This must not receive provider credentials remotely',
      });

      expect(result).toEqual(
        expect.objectContaining({
          error: expect.stringContaining('Desktop local execution'),
          status: 'error',
          success: false,
        }),
      );
      expect(topicMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: type === 'codex' ? 'gpt-test' : 'claude-test',
          provider: type === 'codex' ? 'openai' : 'anthropic',
        }),
        undefined,
      );
      expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
      expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    },
  );

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

  it('reserves cloud conversation history for a retry without native resume', async () => {
    mockGetHeterogeneousResumeSessionId.mockResolvedValue('cloud-session-existing');
    mockMessageQuery.mockResolvedValue([
      { content: 'Earlier cloud question', id: 'old-user', role: 'user' },
      { content: 'Earlier cloud answer', id: 'old-assistant', role: 'assistant' },
      { content: 'Continue in cloud', id: 'msg-1', role: 'user' },
    ]);
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'claude-code' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Continue in cloud',
    });

    expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeFallbackSystemContext: expect.stringContaining('Earlier cloud question'),
        resumeSessionId: 'cloud-session-existing',
        systemContext: expect.not.stringContaining('<previous_conversation>'),
      }),
    );
    const { resumeFallbackSystemContext } = mockSpawnHeteroSandbox.mock.calls[0][0];
    expect(resumeFallbackSystemContext).toContain('Earlier cloud answer');
    expect(resumeFallbackSystemContext).not.toContain('Continue in cloud');
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
    expect(dispatchParams).toEqual(
      expect.objectContaining({ assistantMessageId: 'msg-1', deviceId: 'device-1' }),
    );
    expect(dispatchParams.args).toEqual(['--model', 'opus', '--effort', 'high']);
  });

  it('dispatches CodeBuddy to a bound device with its model and effort args', async () => {
    heteroAgentConfig.model = 'codebuddy';
    heteroAgentConfig.provider = 'codebuddy';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        effort: 'high',
        model: 'gpt-5.4',
        type: 'codebuddy',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use CodeBuddy on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'codebuddy',
        args: ['--model', 'gpt-5.4', '--effort', 'high'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('dispatches TRAE to a bound device with encoded native args and its ACP model', async () => {
    heteroAgentConfig.model = 'trae';
    heteroAgentConfig.provider = 'trae';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        args: ['--feature', 'test'],
        effort: 'high',
        model: 'gpt-5.4',
        type: 'trae',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use TRAE on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'trae',
        args: ['--agent-arg=--feature', '--agent-arg=test', '--model', 'gpt-5.4'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('resumes a native device session with device-specific context', async () => {
    mockGetHeterogeneousResumeSessionId.mockResolvedValue('native-session-existing');
    mockMessageQuery.mockResolvedValue([
      { content: 'Earlier question', id: 'old-user', role: 'user' },
      { content: 'Earlier answer', id: 'old-assistant', role: 'assistant' },
      { content: 'Continue on my device', id: 'msg-1', role: 'user' },
    ]);
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Continue on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeFallbackSystemContext: 'device recovery context',
        resumeSessionId: 'native-session-existing',
        systemContext: 'device context',
      }),
    );
    expect(mockBuildRemoteDeviceHeteroContext).toHaveBeenNthCalledWith(1, {
      agentSystemContext: undefined,
    });
    expect(mockBuildRemoteDeviceHeteroContext).toHaveBeenNthCalledWith(2, {
      agentSystemContext: undefined,
      conversationHistory: [
        { content: 'Earlier question', role: 'user' },
        { content: 'Earlier answer', role: 'assistant' },
      ],
    });
  });

  /**
   * @example A topic whose native resume token is missing still receives its prior turns.
   */
  it('injects recent conversation history when a device run must start fresh', async () => {
    mockMessageQuery.mockResolvedValue([
      { content: 'Create the GPU pod', id: 'old-user', role: 'user' },
      { content: 'The pod is electron-gpu-shell', id: 'old-assistant', role: 'assistant' },
      { content: 'Delete it', id: 'msg-1', role: 'user' },
    ]);
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Delete it',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeFallbackSystemContext: undefined,
        resumeSessionId: undefined,
        systemContext: 'device recovery context',
      }),
    );
    expect(mockBuildRemoteDeviceHeteroContext).toHaveBeenCalledWith({
      agentSystemContext: undefined,
      conversationHistory: [
        { content: 'Create the GPU pod', role: 'user' },
        { content: 'The pod is electron-gpu-shell', role: 'assistant' },
      ],
    });
  });

  it('dispatches OpenCode to a bound device with its model args', async () => {
    heteroAgentConfig.model = 'opencode';
    heteroAgentConfig.provider = 'opencode';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        model: 'anthropic/claude-sonnet-4',
        type: 'opencode',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use OpenCode on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'opencode',
        args: ['--model', 'anthropic/claude-sonnet-4'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('dispatches Kimi Code to a bound device with its model args', async () => {
    heteroAgentConfig.model = 'kimi-code';
    heteroAgentConfig.provider = 'kimi-code';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        model: 'kimi-for-coding',
        type: 'kimi-code',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use Kimi Code on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'kimi-code',
        args: ['--model', 'kimi-for-coding'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('dispatches Cursor to a bound device with its model args', async () => {
    heteroAgentConfig.model = 'cursor';
    heteroAgentConfig.provider = 'cursor';
    heteroAgentConfig.agencyConfig = {
      boundDeviceId: 'device-1',
      executionTarget: 'device',
      heterogeneousProvider: {
        model: 'sonnet-4-thinking',
        type: 'cursor',
      },
    } as any;

    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Use Cursor on my device',
    });

    expect(mockDispatchAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'cursor',
        args: ['--model', 'sonnet-4-thinking'],
        deviceId: 'device-1',
      }),
    );
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('never falls back to a cloud sandbox for unbound OpenCode', async () => {
    heteroAgentConfig.model = 'opencode';
    heteroAgentConfig.provider = 'opencode';
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'opencode' },
    } as any;

    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Do not run OpenCode in cloud',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'error', success: false }));
    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('never falls back to a cloud sandbox for unbound Cursor', async () => {
    heteroAgentConfig.model = 'cursor';
    heteroAgentConfig.provider = 'cursor';
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'cursor' },
    } as any;

    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Do not run Cursor in cloud',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'error', success: false }));
    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('never falls back to a cloud sandbox for unbound CodeBuddy', async () => {
    heteroAgentConfig.model = 'codebuddy';
    heteroAgentConfig.provider = 'codebuddy';
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'codebuddy' },
    } as any;

    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Do not run CodeBuddy in cloud',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'error', success: false }));
    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
  });

  it('never falls back to a cloud sandbox for unbound TRAE', async () => {
    heteroAgentConfig.model = 'trae';
    heteroAgentConfig.provider = 'trae';
    heteroAgentConfig.agencyConfig = {
      executionTarget: 'sandbox',
      heterogeneousProvider: { type: 'trae' },
    } as any;

    const result = await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Do not run TRAE in cloud',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'error', success: false }));
    expect(mockDispatchAgentRun).not.toHaveBeenCalled();
    expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
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

    const findRunningOpSeed = () =>
      topicMock.updateMetadata.mock.calls
        .map((call) => call[1])
        .find((patch: any) => patch?.runningOperation?.operationId);

    it('keeps the supervisor marker when an in-group hetero child is dispatched', async () => {
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'supervisor-assistant',
            operationId: 'parent-operation',
          },
        },
      });

      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          isolationThread: false,
          orchestrationRole: 'member',
          topicId: 'topic-1',
        },
        parentOperationId: 'parent-operation',
        prompt: 'speak as member',
        topicStartOwnerOperationId: 'parent-operation',
      } as any);

      expect(topicMock.appendRunningOperationChild).toHaveBeenCalledWith(
        'topic-1',
        'parent-operation',
        expect.objectContaining({ operationId: expect.stringContaining('op_') }),
      );
      expect(topicMock.tryReserveTaskCallback).toHaveBeenCalledWith('topic-1', expect.any(String), {
        allowRunningOperationId: 'parent-operation',
        allowSameReservationReentry: true,
        ignoreRunningOperation: undefined,
        replacesOperationId: undefined,
      });
      expect(mockCreateOperationMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mirrorToOperationId: 'parent-operation' }),
      );
      expect(mockPublishAgentRuntimeInit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mirrorToOperationId: 'parent-operation' }),
      );
    });

    it('threads the parent operation through remote member dispatch', async () => {
      heteroAgentConfig.agencyConfig = {
        executionTarget: 'local',
        heterogeneousProvider: { type: 'openclaw' },
      } as any;
      heteroAgentConfig.model = 'openclaw';
      heteroAgentConfig.provider = 'lobehub';
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'supervisor-assistant',
            operationId: 'parent-operation',
          },
        },
      });

      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          orchestrationRole: 'member',
          topicId: 'topic-1',
        },
        localDeviceId: 'personal-desktop',
        parentOperationId: 'parent-operation',
        prompt: 'run this member',
        topicStartOwnerOperationId: 'parent-operation',
      } as any);

      expect(mockPublishAgentRuntimeInit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mirrorToOperationId: 'parent-operation' }),
      );
      expect(mockCreateOperationMetadata).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mirrorToOperationId: 'parent-operation' }),
      );
      const toolCall = mockExecuteToolCall.mock.calls.at(-1)?.[1];
      expect(JSON.parse(toolCall.arguments)).toEqual(
        expect.objectContaining({ parentOperationId: 'parent-operation' }),
      );
    });

    it('does not dispatch a member after its supervisor marker was cleared', async () => {
      topicMock.appendRunningOperationChild.mockResolvedValue(false);

      const result = await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          isolationThread: false,
          orchestrationRole: 'member',
          topicId: 'topic-1',
        },
        parentOperationId: 'parent-operation',
        prompt: 'speak as member',
        topicStartOwnerOperationId: 'parent-operation',
      } as any);

      expect(result).toMatchObject({ status: 'error', success: false });
      expect(mockSpawnHeteroSandbox).not.toHaveBeenCalled();
      expect(mockDispatchAgentRun).not.toHaveBeenCalled();
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

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

    it('forwards the topic workspace as ingestWorkspaceId on device hetero dispatch', async () => {
      heteroAgentConfig.agencyConfig = {
        boundDeviceId: 'device-1',
        executionTarget: 'device',
        heterogeneousProvider: { type: 'claude-code' },
      } as any;
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-a' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'do the task on my device',
      } as any);

      expect(mockDispatchAgentRun).toHaveBeenCalledWith(
        expect.objectContaining({ ingestWorkspaceId: 'workspace-a' }),
      );
    });

    it('forwards the topic workspace into the cloud sandbox hetero spawn', async () => {
      heteroAgentConfig.agencyConfig = {
        heterogeneousProvider: { type: 'claude-code' },
      } as any;
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-a' });

      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'do the task in the cloud sandbox',
      } as any);

      expect(mockSpawnHeteroSandbox).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'workspace-a' }),
      );
    });

    it('keeps the conversation workspace separate from a personal platform device scope', async () => {
      heteroAgentConfig.agencyConfig = {
        executionTarget: 'local',
        heterogeneousProvider: { platformAgentId: 'researcher', type: 'openclaw' },
      } as any;
      (heteroAgentConfig as any).userId = userId;
      (heteroAgentConfig as any).visibility = 'public';
      (heteroAgentConfig as any).workspaceId = 'workspace-a';
      service = new AiAgentService(mockDb, userId, { workspaceId: 'workspace-a' });

      await service.execAgent({
        agentId: 'agent-1',
        localDeviceId: 'personal-desktop',
        prompt: 'do the task on this computer',
      } as any);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        {
          deviceId: 'personal-desktop',
          userId,
          workspaceId: undefined,
        },
        expect.objectContaining({
          apiName: 'runHeteroTask',
          arguments: expect.any(String),
        }),
        120_000,
      );
      const toolCall = mockExecuteToolCall.mock.calls.at(-1)?.[1];
      expect(JSON.parse(toolCall.arguments)).toEqual(
        expect.objectContaining({
          agentType: 'openclaw',
          platformAgentId: 'researcher',
          workspaceId: 'workspace-a',
        }),
      );
      const seed = findRunningOpSeed();
      expect(seed.runningOperation).toEqual(
        expect.objectContaining({
          deviceId: 'personal-desktop',
          deviceUserId: userId,
          heteroType: 'openclaw',
        }),
      );
    });

    it("routes a legacy author binding through the author's personal principal", async () => {
      heteroAgentConfig.agencyConfig = {
        boundDeviceId: 'author-desktop',
        heterogeneousProvider: { type: 'openclaw' },
      } as any;
      (heteroAgentConfig as any).userId = 'author-user';
      (heteroAgentConfig as any).visibility = 'public';
      (heteroAgentConfig as any).workspaceId = 'workspace-a';
      service = new AiAgentService(mockDb, 'member-user', { workspaceId: 'workspace-a' });

      await service.execAgent({
        agentId: 'agent-1',
        localDeviceId: 'member-desktop',
        prompt: 'run the legacy-bound task',
      } as any);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        {
          deviceId: 'author-desktop',
          userId: 'author-user',
          workspaceId: undefined,
        },
        expect.objectContaining({ apiName: 'runHeteroTask' }),
        120_000,
      );
      const seed = findRunningOpSeed();
      expect(seed.runningOperation).toEqual(
        expect.objectContaining({
          deviceId: 'author-desktop',
          deviceUserId: 'author-user',
          heteroType: 'openclaw',
        }),
      );
    });

    it('cancels a platform task through the principal persisted at dispatch', async () => {
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            deviceId: 'author-desktop',
            deviceUserId: 'author-user',
            heteroType: 'openclaw',
            operationId: 'operation-1',
          },
        },
      });

      await service.interruptTask({ operationId: 'operation-1', topicId: 'topic-1' });

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        {
          deviceId: 'author-desktop',
          userId: 'author-user',
          workspaceId: undefined,
        },
        expect.objectContaining({ apiName: 'cancelHeteroTask' }),
        10_000,
      );
    });

    /**
     * @example Stopping a device Codex run sends `cancelHeteroTask` to that device.
     */
    it('cancels a device local hetero run before releasing its topic', async () => {
      mockExecuteToolCall.mockResolvedValueOnce({ success: true, state: { exited: true } });
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-codex',
            deviceId: 'author-desktop',
            deviceUserId: 'author-user',
            heteroType: 'codex',
            operationId: 'operation-codex',
          },
        },
      });

      const result = await service.interruptTask({
        operationId: 'operation-codex',
        topicId: 'topic-1',
      });

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        {
          deviceId: 'author-desktop',
          userId: 'author-user',
          workspaceId: undefined,
        },
        expect.objectContaining({
          apiName: 'cancelHeteroTask',
          arguments: JSON.stringify({ signal: 'SIGINT', taskId: 'operation-codex' }),
        }),
        10_000,
      );
      expect(result.deviceCancellationConfirmed).toBe(true);
    });

    /**
     * @example A device response with `exited: false` remains an unsafe cancellation result.
     */
    it('reports an unconfirmed device local hetero cancellation', async () => {
      // ROOT CAUSE:
      //
      // A successful Gateway envelope only proves that the device handled the
      // tool call. The nested cancellation state is authoritative for whether
      // the native writer actually exited.
      //
      // Before: `{ success: true, state: { exited: false } }` was ignored.
      // After: interruptTask surfaces `deviceCancellationConfirmed: false`.
      mockExecuteToolCall.mockResolvedValueOnce({ success: true, state: { exited: false } });
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            deviceId: 'author-desktop',
            deviceUserId: 'author-user',
            heteroType: 'codex',
            operationId: 'operation-codex',
          },
        },
      });

      const result = await service.interruptTask({
        operationId: 'operation-codex',
        topicId: 'topic-1',
      });

      expect(result).toMatchObject({
        deviceCancellationConfirmed: false,
        operationId: 'operation-codex',
        success: true,
      });
    });

    it('cancels a remote child operation without touching the supervisor device', async () => {
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            deviceId: 'supervisor-desktop',
            deviceUserId: 'supervisor-user',
            heteroType: 'openclaw',
            operationId: 'operation-parent',
            childOperations: [
              {
                deviceId: 'member-desktop',
                deviceUserId: 'member-user',
                heteroType: 'hermes',
                operationId: 'operation-child',
              },
            ],
          },
        },
      });

      await service.interruptTask({ operationId: 'operation-child', topicId: 'topic-1' });

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        {
          deviceId: 'member-desktop',
          userId: 'member-user',
          workspaceId: undefined,
        },
        expect.objectContaining({
          apiName: 'cancelHeteroTask',
          arguments: JSON.stringify({ signal: 'SIGINT', taskId: 'operation-child' }),
        }),
        10_000,
      );
    });

    it('recovers the topic from the operation when the cancellation caller omits it', async () => {
      (service as any).agentOperationModel.findById = vi
        .fn()
        .mockResolvedValue({ topicId: 'topic-from-operation' });
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            deviceId: 'member-desktop',
            deviceUserId: userId,
            heteroType: 'hermes',
            operationId: 'operation-1',
          },
        },
      });

      await service.interruptTask({ operationId: 'operation-1' });

      expect(topicMock.findById).toHaveBeenCalledWith('topic-from-operation');
      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'member-desktop', userId }),
        expect.objectContaining({ apiName: 'cancelHeteroTask' }),
        10_000,
      );
    });

    it('does not cancel a newer operation currently running on the same topic', async () => {
      topicMock.findById.mockResolvedValue({
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-2',
            deviceId: 'member-desktop',
            deviceUserId: userId,
            heteroType: 'openclaw',
            operationId: 'operation-2',
          },
        },
      });

      await service.interruptTask({ operationId: 'operation-1', topicId: 'topic-1' });

      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    // Regression guard: a callAgent/callSubAgent-spawned hetero
    // child (isolation-thread, no topicStartOwnerOperationId) must still get
    // its userId/workspaceId written to the state-manager metadata store —
    // subAgentCallback reads it to authorize resuming the parked parent
    // operation. Without it, the completion webhook 401s, the parent is
    // never resumed, and it stays parked until the inactivity watchdog
    // abandons it ~10 minutes later.
    it('persists userId/workspaceId metadata for a callAgent-spawned hetero child', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: { isolationThread: true, topicId: 'topic-1' },
        parentOperationId: 'parent-operation',
        prompt: 'do the task as a callAgent child',
      } as any);

      const call = mockCreateOperationMetadata.mock.calls.find(
        ([, data]) => data.userId === 'test-user-id',
      );
      expect(call).toBeDefined();
      // No topic-owner mirror target on this path — mirrorToOperationId must
      // stay unset rather than being derived from parentOperationId.
      expect(call?.[1]).not.toHaveProperty('mirrorToOperationId');
    });

    it('nests an isolation-thread child under the parent marker instead of claiming topic root', async () => {
      // heteroIngest/heteroFinish resolve an operationId via
      // topic.metadata.runningOperation (root or childOperations) — a plain
      // updateMetadata() here would clobber the parent's own root marker
      // instead of nesting under it.
      await service.execAgent({
        agentId: 'agent-1',
        appContext: { isolationThread: true, topicId: 'topic-1' },
        parentOperationId: 'parent-operation',
        prompt: 'do the task as a callAgent child',
      } as any);

      expect(topicMock.appendRunningOperationChild).toHaveBeenCalledWith(
        'topic-1',
        'parent-operation',
        expect.objectContaining({ operationId: expect.stringContaining('op_') }),
      );
      // Not claimed as the topic's own root marker.
      expect(findRunningOpSeed()).toBeUndefined();
    });

    it('falls back to claiming the topic marker when the parent is not the current root (e.g. nested isolation chain)', async () => {
      topicMock.appendRunningOperationChild.mockResolvedValueOnce(false);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { isolationThread: true, topicId: 'topic-1' },
        parentOperationId: 'parent-operation',
        prompt: 'do the task as a callAgent child',
      } as any);

      // Otherwise this child would never be recognized by
      // heteroIngest/heteroFinish at all.
      expect(findRunningOpSeed()).toBeDefined();
    });
  });
});
