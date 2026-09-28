import { ThreadStatus, ThreadType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecGroupMemberParams } from '@/server/services/agentRuntime/types';

import { AiAgentService } from '../index';

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

// Mock ThreadModel
const mockThreadModel = {
  claimForRun: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
};

const mockOperationFindById = vi.fn();
const mockLoadGroupMemberBridge = vi.fn();
const mockFindMessagePlugin = vi.fn();

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(function () {
    return mockThreadModel;
  }),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn().mockImplementation(function () {
    return {
      findById: mockOperationFindById,
    };
  }),
}));

// Mock other models
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn(),
      queryAgents: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      findMessagePlugin: mockFindMessagePlugin,
      getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
      getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(function () {
    return {
      query: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return {
      releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
      tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
      findById: vi.fn().mockResolvedValue(null),
    };
  }),
}));

// Mock AgentService
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(function () {
    return {
      getAgentConfig: vi.fn().mockResolvedValue({
        chatConfig: {},
        id: 'agent-1',
        model: 'gpt-4',
        plugins: [],
        provider: 'openai',
      }),
    };
  }),
}));

const mockScheduleGroupMemberTimeout = vi.fn();

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn().mockResolvedValue({
        autoStarted: true,
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        success: true,
      }),
      loadGroupMemberBridge: mockLoadGroupMemberBridge,
      scheduleGroupMemberTimeout: mockScheduleGroupMemberTimeout,
    };
  }),
}));

// Mock MarketService
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(function () {
    return {
      getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

// Mock ComposioService
vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(function () {
    return {
      getComposioManifests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

const execAgentResult = {
  agentId: 'agt_carol',
  assistantMessageId: 'assistant-msg-1',
  autoStarted: true,
  createdAt: new Date().toISOString(),
  message: 'Agent operation created successfully',
  messageId: 'queue-msg-1',
  operationId: 'op-member',
  status: 'created',
  success: true,
  timestamp: new Date().toISOString(),
  topicId: 'topic-1',
  userMessageId: 'user-msg-1',
};

const memberParams = (overrides: Partial<ExecGroupMemberParams> = {}): ExecGroupMemberParams => ({
  agentId: 'agt_carol',
  anchorMessageId: 'anchor-1',
  expectedMembers: 1,
  groupId: 'group-1',
  groupToolMessageId: 'anchor-1',
  instruction: 'Run the script',
  mode: 'in_group',
  onComplete: 'resume',
  parentOperationId: 'op-sup',
  supervisorMessageId: 'sup-msg-1',
  topicId: 'topic-1',
  ...overrides,
});

describe('AiAgentService.execGroupMember', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockThreadModel.create.mockResolvedValue({
      agentId: 'agt_carol',
      groupId: 'group-1',
      id: 'thread-123',
      status: ThreadStatus.Active,
      topicId: 'topic-1',
      type: ThreadType.Isolation,
    });
    mockThreadModel.update.mockResolvedValue({});
    mockOperationFindById.mockResolvedValue({ trigger: 'chat' });
    service = new AiAgentService({} as any, 'test-user-id');
  });

  // G-05: a member answers to the approval mode the user picked for the turn.
  // A hard-coded headless let a member silently run a `humanIntervention:
  // 'required'` tool (execScript) that the supervisor itself had to ask for.
  describe('approval policy', () => {
    const manual = { approvalMode: 'manual' } as const;

    it.each(['in_group', 'isolated'] as const)(
      'forwards the supervisor approval mode to a %s member',
      async (mode) => {
        const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue(execAgentResult);

        await service.execGroupMember(memberParams({ mode, userInterventionConfig: manual }));

        expect(execAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({ userInterventionConfig: manual }),
        );
      },
    );

    it('keeps headless when the supervisor carries no approval policy', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue(execAgentResult);

      await service.execGroupMember(memberParams());

      expect(execAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userInterventionConfig: { approvalMode: 'headless' } }),
      );
    });
  });

  // Codex P2 on #20093: the client told a member continuation apart by
  // comparing agent ids, which misfires when the supervisor dispatched itself.
  it('flags an approval that continues a group member', async () => {
    mockFindMessagePlugin.mockResolvedValue({
      intervention: { operationId: 'op-carol', status: 'pending' },
    });
    mockLoadGroupMemberBridge.mockResolvedValue({
      agentId: 'agt_sup',
      bridge: {
        anchorMessageId: 'msg-speak',
        expectedMembers: 1,
        groupToolMessageId: 'msg-speak',
        mode: 'in_group',
        onComplete: 'resume',
        parentOperationId: 'op-sup',
      },
      groupId: 'group-1',
      topicId: 'topic-1',
    });
    const original = service.execAgent.bind(service);
    vi.spyOn(service, 'execAgent')
      .mockImplementationOnce(original)
      .mockResolvedValueOnce(execAgentResult);

    const result = await service.execAgent({
      agentId: 'agt_sup',
      appContext: { groupId: 'group-1', topicId: 'topic-1' },
      prompt: '',
      resumeApproval: { decision: 'approved', parentMessageId: 'msg-tool', toolCallId: 'call-1' },
    } as any);

    expect(result).toMatchObject({ groupMemberContinuation: true });
  });

  // Codex P1 on #20093: an approval continuation retires the parked member op,
  // which disarmed the member's timeout watchdog.
  describe('member deadline across an approval continuation', () => {
    const continueMember = async (deadlineAt?: number) => {
      mockFindMessagePlugin.mockResolvedValue({
        intervention: { operationId: 'op-carol', status: 'pending' },
      });
      mockLoadGroupMemberBridge.mockResolvedValue({
        agentId: 'agt_carol',
        bridge: {
          anchorMessageId: 'msg-task',
          ...(deadlineAt && { deadlineAt }),
          expectedMembers: 1,
          groupToolMessageId: 'msg-task',
          mode: 'isolated',
          onComplete: 'resume',
          parentOperationId: 'op-sup',
        },
        groupId: 'group-1',
        topicId: 'topic-1',
      });
      const original = service.execAgent.bind(service);
      vi.spyOn(service, 'execAgent')
        .mockImplementationOnce(original)
        .mockResolvedValueOnce({ ...execAgentResult, operationId: 'op-carol-continued' });

      await service.execAgent({
        agentId: 'agt_sup',
        appContext: { groupId: 'group-1', topicId: 'topic-1' },
        prompt: '',
        resumeApproval: { decision: 'approved', parentMessageId: 'msg-tool', toolCallId: 'call-1' },
      } as any);
    };

    it('re-arms the remaining time on the continuation', async () => {
      await continueMember(Date.now() + 60_000);

      expect(mockScheduleGroupMemberTimeout).toHaveBeenCalledWith(
        expect.objectContaining({
          memberOperationId: 'op-carol-continued',
          mode: 'isolated',
          parentOperationId: 'op-sup',
        }),
        expect.any(Number),
      );
      const [, delayMs] = mockScheduleGroupMemberTimeout.mock.calls[0];
      expect(delayMs).toBeGreaterThan(55_000);
      expect(delayMs).toBeLessThanOrEqual(60_000);
    });

    it("records an isolated member's absolute deadline in its bridge", async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue(execAgentResult);
      const before = Date.now();

      await service.execGroupMember(memberParams({ mode: 'isolated', timeout: 30_000 }));

      const hooks = execAgentSpy.mock.calls[0][0].hooks ?? [];
      const body = hooks.find((hook) => hook.id === 'group-member-bridge')?.webhook?.body as
        { deadlineAt?: number } | undefined;
      expect(body?.deadlineAt).toBeGreaterThanOrEqual(before + 30_000);
      expect(body?.deadlineAt).toBeLessThanOrEqual(Date.now() + 30_000);
    });

    it('fires at once when the deadline passed while the approval waited', async () => {
      await continueMember(Date.now() - 1000);

      expect(mockScheduleGroupMemberTimeout).toHaveBeenCalledWith(
        expect.objectContaining({ memberOperationId: 'op-carol-continued' }),
        1,
      );
    });

    it('arms nothing for a member without a timeout', async () => {
      await continueMember();

      expect(mockScheduleGroupMemberTimeout).not.toHaveBeenCalled();
    });
  });
});
