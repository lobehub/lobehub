import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ResumeModule from '../client-tool-resume.responses';
import { ResponsesService } from '../responses.service';

const {
  assertAgentMock,
  assertConversationMock,
  assertParkedAgentMock,
  execAgentMock,
  executeResponseRunMock,
  findTopicMock,
  permissionMock,
  resolveParkedCallerRunMock,
  resumeParkedClientToolsMock,
} = vi.hoisted(() => ({
  assertAgentMock: vi.fn(),
  assertConversationMock: vi.fn(),
  assertParkedAgentMock: vi.fn(),
  execAgentMock: vi.fn(),
  executeResponseRunMock: vi.fn(),
  findTopicMock: vi.fn(),
  permissionMock: vi.fn(),
  resolveParkedCallerRunMock: vi.fn(),
  resumeParkedClientToolsMock: vi.fn(),
}));

vi.mock('@/server/modules/AgentRuntime/factory', () => ({
  createStreamEventManager: () => ({ drainPushes: vi.fn() }),
}));
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: class {
    executeSync = executeResponseRunMock;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgentMock;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = findTopicMock;
  },
}));
vi.mock('@/server/routers/lambda/_helpers/workspaceAgentGuard', () => ({
  assertCanUseWorkspaceAgent: assertAgentMock,
}));
vi.mock('@/server/routers/lambda/aiAgent/guards', () => ({
  assertCanUseAgentRunConversation: assertConversationMock,
}));
vi.mock('../client-tool-resume.responses', async (importOriginal) => {
  const actual = await importOriginal<typeof ResumeModule>();
  return {
    ...actual,
    assertCanResumeParkedRun: assertParkedAgentMock,
    executeResponseRun: executeResponseRunMock,
    resolveParkedCallerRun: resolveParkedCallerRunMock,
    resumeParkedClientTools: resumeParkedClientToolsMock,
  };
});
// The real BaseService resolves RBAC through RbacModel; the permission result
// is the input under test, so the stub exposes it directly and mimics the
// named-error factories the controller maps to HTTP statuses.
vi.mock('../../common/base.service', () => ({
  BaseService: class {
    db: any;
    userId: string;
    workspaceId?: string;
    constructor(db: any, userId: string, workspaceId?: string) {
      this.db = db;
      this.userId = userId;
      this.workspaceId = workspaceId;
    }
    log() {}
    resolveOperationPermission = permissionMock;
    createAuthorizationError(message: string) {
      return Object.assign(new Error(message), { name: 'AuthorizationError' });
    }
    createNotFoundError(message: string) {
      return Object.assign(new Error(message), { name: 'NotFoundError' });
    }
  },
}));

const forbidden = () =>
  Object.assign(new Error('You do not have permission to use this resource'), {
    code: 'FORBIDDEN',
    name: 'TRPCError',
  });

const buildService = (workspaceId = 'ws_1') =>
  new ResponsesService(null as any, 'user_1', workspaceId);

describe('ResponsesService.run authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionMock.mockResolvedValue({ isPermitted: true });
    assertAgentMock.mockResolvedValue(undefined);
    assertConversationMock.mockResolvedValue(undefined);
    findTopicMock.mockResolvedValue({ id: 'tpc_1', userId: 'user_2' });
    resolveParkedCallerRunMock.mockResolvedValue(undefined);
    assertParkedAgentMock.mockResolvedValue(undefined);
    resumeParkedClientToolsMock.mockResolvedValue(undefined);
    execAgentMock.mockResolvedValue({ operationId: 'op_1', success: true, topicId: 'tpc_1' });
    executeResponseRunMock.mockResolvedValue({ messages: [], status: 'done', stepCount: 1 });
  });

  it('rejects a caller without message:create (e.g. a workspace viewer) before starting a run', async () => {
    permissionMock.mockResolvedValue({ isPermitted: false, message: 'view only' });

    await expect(
      buildService().createResponse({ input: 'hi', model: 'agt_1' }),
    ).rejects.toMatchObject({ name: 'AuthorizationError' });
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('rejects running an agent the caller may only view, never reaching execAgent', async () => {
    assertAgentMock.mockRejectedValue(forbidden());

    await expect(
      buildService().createResponse({ input: 'hi', model: 'agt_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assertAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', userId: 'user_1', workspaceId: 'ws_1' }),
    );
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('rejects a previous_response_id whose topic is invisible to the caller', async () => {
    findTopicMock.mockResolvedValue(null);

    await expect(
      buildService().createResponse({
        input: 'hi',
        model: 'agt_1',
        previous_response_id: 'tpc_private',
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(assertConversationMock).not.toHaveBeenCalled();
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('rejects a previous_response_id on a conversation the caller cannot use', async () => {
    assertConversationMock.mockRejectedValue(forbidden());

    await expect(
      buildService().createResponse({
        input: 'hi',
        model: 'agt_1',
        previous_response_id: 'tpc_1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assertConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'tpc_1', userId: 'user_1', workspaceId: 'ws_1' }),
    );
    expect(execAgentMock).not.toHaveBeenCalled();
    expect(resumeParkedClientToolsMock).not.toHaveBeenCalled();
  });

  it('rejects a denied streaming run as a failed response event, never executing', async () => {
    assertAgentMock.mockRejectedValue(forbidden());

    const events: any[] = [];
    for await (const event of buildService().createStreamingResponse({
      input: 'hi',
      model: 'agt_1',
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      response: { status: 'failed' },
      type: 'response.failed',
    });
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  it('runs the same guard chain before resuming a parked client-tool run', async () => {
    assertConversationMock.mockRejectedValue(forbidden());
    resumeParkedClientToolsMock.mockResolvedValue({ operationId: 'op_parked' });

    await expect(
      buildService().createResponse({
        input: [{ call_id: 'call_1', output: 'sunny', type: 'function_call_output' }],
        model: 'agt_1',
        previous_response_id: 'tpc_1',
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(resumeParkedClientToolsMock).not.toHaveBeenCalled();
  });

  // Regression (security review): the parked run resumes with its operation's
  // agent, which can differ from `model` — preflight must deny that agent in
  // read-only checks so the refusal stays an HTTP error, not a failed body.
  it('rejects a resume whose parked run agent the caller may not use, before resuming', async () => {
    resolveParkedCallerRunMock.mockResolvedValue({ operationId: 'op_parked' });
    assertParkedAgentMock.mockRejectedValue(forbidden());
    resumeParkedClientToolsMock.mockResolvedValue({ operationId: 'op_parked' });

    await expect(
      buildService().createResponse({
        input: [{ call_id: 'call_1', output: 'sunny', type: 'function_call_output' }],
        model: 'agt_1',
        previous_response_id: 'tpc_1',
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(resumeParkedClientToolsMock).not.toHaveBeenCalled();
    expect(execAgentMock).not.toHaveBeenCalled();
  });

  // Regression (security review): a guard refusal thrown inside the resumed
  // run (e.g. the parked check racing preflight) must propagate to the
  // controller's HTTP mapping, not collapse into a 200 `server_error`.
  it('propagates a refusal thrown mid-resume instead of returning a failed response', async () => {
    resumeParkedClientToolsMock.mockRejectedValue(forbidden());

    await expect(
      buildService().createResponse({
        input: [{ call_id: 'call_1', output: 'sunny', type: 'function_call_output' }],
        model: 'agt_1',
        previous_response_id: 'tpc_1',
      } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('passes the authorized request through to execAgent', async () => {
    const response = await buildService().createResponse({
      input: 'hi',
      model: 'agt_1',
      previous_response_id: 'tpc_1',
    });

    expect(response.status).toBe('completed');
    expect(execAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agt_1', appContext: { topicId: 'tpc_1' } }),
    );
  });
});
