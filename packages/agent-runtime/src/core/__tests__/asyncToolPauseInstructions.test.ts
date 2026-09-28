import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { GeneralChatAgent } from '../../agents/GeneralChatAgent';
import type {
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  InstructionExecutor,
} from '../../types';
import { AgentRuntime } from '../runtime';

const subAgentCall: ChatToolPayload = {
  apiName: 'callSubAgent',
  arguments: '{"instruction":"research"}',
  id: 'call_sub_agent',
  identifier: 'lobe-agent',
  type: 'builtin',
};

const askUserCall: ChatToolPayload = {
  apiName: 'askUserQuestion',
  arguments: '{"question":"Which option?"}',
  id: 'call_ask_user',
  identifier: 'lobe-agent',
  type: 'builtin',
};

const toolManifestMap = {
  'lobe-agent': {
    api: [
      { description: '', humanIntervention: 'never', name: 'callSubAgent', parameters: {} },
      { description: '', humanIntervention: 'always', name: 'askUserQuestion', parameters: {} },
    ],
    identifier: 'lobe-agent',
    meta: {},
    type: 'builtin',
  },
} as any;

const createAgent = () =>
  new GeneralChatAgent({
    agentConfig: { maxSteps: 100 },
    modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
    operationId: 'op-async-pause',
  });

const createState = (overrides?: Partial<AgentState>): AgentState =>
  AgentRuntime.createInitialState({
    messages: [
      { content: 'Plan the trip', id: 'msg-user', role: 'user' },
      { content: '', id: 'msg-assistant', role: 'assistant' },
    ],
    operationId: 'op-async-pause',
    status: 'running',
    toolManifestMap,
    ...overrides,
  });

const llmResultContext = (toolsCalling: ChatToolPayload[]): AgentRuntimeContext => ({
  payload: {
    hasToolsCalling: true,
    parentMessageId: 'msg-assistant',
    result: { content: '', tool_calls: [] },
    toolsCalling,
  },
  phase: 'llm_result',
  session: { messageCount: 2, sessionId: 'op-async-pause', status: 'running', stepCount: 1 },
});

/** `call_tool` stub that parks the op the way a deferred sub-agent tool does. */
const parkingCallTool = vi.fn<InstructionExecutor>(async (instruction, state) => {
  const { payload } = instruction as Extract<AgentInstruction, { type: 'call_tool' }>;
  const newState = structuredClone(state);
  newState.status = 'waiting_for_async_tool';
  newState.pendingToolsCalling = [(payload as any).toolCalling];
  newState.interruption = {
    canResume: true,
    interruptedAt: new Date().toISOString(),
    reason: 'async_tool',
  };
  return { events: [], newState };
});

const createHumanApprove = () =>
  vi.fn<InstructionExecutor>(async (instruction, state) => {
    const { pendingToolsCalling } = instruction as Extract<
      AgentInstruction,
      { type: 'request_human_approve' }
    >;
    const newState = structuredClone(state);
    newState.status = 'waiting_for_human';
    newState.pendingToolsCalling = pendingToolsCalling;
    return { events: [], newState };
  });

/** What the server does when every deferred tool has delivered its result. */
const resumeFromAsyncTool = (state: AgentState): [AgentState, AgentRuntimeContext] => {
  const resumed = structuredClone(state);
  resumed.status = 'running';
  resumed.pendingToolsCalling = [];
  resumed.interruption = undefined;
  return [
    resumed,
    {
      payload: { parentMessageId: 'msg-sub-agent-tool' },
      phase: 'user_input',
      session: { messageCount: 3, sessionId: 'op-async-pause', status: 'running', stepCount: 2 },
    },
  ];
};

describe('AgentRuntime instructions queued behind an async tool pause', () => {
  it('asks the human-approval question after the async tool resumes instead of dropping it', async () => {
    const agent = createAgent();
    const state = createState();

    const instructions = await agent.runner(
      llmResultContext([subAgentCall, askUserCall]),
      structuredClone(state),
    );
    expect(
      (Array.isArray(instructions) ? instructions : [instructions]).map((i) => i.type),
    ).toEqual(['call_tool', 'request_human_approve']);

    const humanApprove = createHumanApprove();
    const callLlm = vi.fn<InstructionExecutor>(async (_instruction, s) => ({
      events: [],
      newState: structuredClone(s),
    }));
    const runtime = new AgentRuntime(agent, {
      executors: {
        call_llm: callLlm,
        call_tool: parkingCallTool,
        request_human_approve: humanApprove,
      },
    });

    // Step 1: the sub-agent parks the operation.
    const parked = await runtime.step(state, llmResultContext([subAgentCall, askUserCall]));
    expect(parked.newState.status).toBe('waiting_for_async_tool');
    expect(parked.newState.pendingToolsCalling).toEqual([subAgentCall]);
    expect(parked.nextContext).toBeUndefined();

    // Step 2: the sub-agent finished and the op resumes. The question the
    // model asked in the same turn must be put to the user before the LLM
    // runs again — otherwise it never gets a tool message.
    const [resumedState, resumeContext] = resumeFromAsyncTool(parked.newState);
    const resumed = await runtime.step(resumedState, resumeContext);

    expect(humanApprove).toHaveBeenCalledTimes(1);
    expect(humanApprove.mock.calls[0][0]).toMatchObject({
      parentMessageId: 'msg-assistant',
      pendingToolsCalling: [askUserCall],
      type: 'request_human_approve',
    });
    expect(callLlm).not.toHaveBeenCalled();
    expect(resumed.newState.status).toBe('waiting_for_human');
    expect(resumed.newState.pendingToolsCalling).toEqual([askUserCall]);
    expect(resumed.newState.deferredHumanApproval).toBeUndefined();
  });

  it('continues with the LLM on resume when nothing was queued behind the pause', async () => {
    const agent = createAgent();
    const humanApprove = createHumanApprove();
    const callLlm = vi.fn<InstructionExecutor>(async (_instruction, s) => ({
      events: [],
      newState: structuredClone(s),
    }));
    const runtime = new AgentRuntime(agent, {
      executors: {
        call_llm: callLlm,
        call_tool: parkingCallTool,
        request_human_approve: humanApprove,
      },
    });

    const parked = await runtime.step(createState(), llmResultContext([subAgentCall]));
    expect(parked.newState.status).toBe('waiting_for_async_tool');
    expect(parked.newState.deferredHumanApproval).toBeUndefined();

    const [resumedState, resumeContext] = resumeFromAsyncTool(parked.newState);
    await runtime.step(resumedState, resumeContext);

    expect(humanApprove).not.toHaveBeenCalled();
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('still persists blocked results for tools queued behind the pause in headless runs', async () => {
    const agent = createAgent();
    const resolveBlocked = vi.fn<InstructionExecutor>(async (_instruction, s) => ({
      events: [],
      newState: structuredClone(s),
    }));
    const runtime = new AgentRuntime(agent, {
      executors: {
        call_tool: parkingCallTool,
        resolve_blocked_tools: resolveBlocked,
      },
    });

    const result = await runtime.step(
      createState({ userInterventionConfig: { approvalMode: 'headless' } }),
      llmResultContext([subAgentCall, askUserCall]),
    );

    expect(resolveBlocked).toHaveBeenCalledTimes(1);
    expect(resolveBlocked.mock.calls[0][0]).toMatchObject({
      payload: { blockedReason: 'human_intervention_unavailable', toolsCalling: [askUserCall] },
      type: 'resolve_blocked_tools',
    });
    expect(result.newState.status).toBe('waiting_for_async_tool');
    expect(result.newState.pendingToolsCalling).toEqual([subAgentCall]);
    expect(result.nextContext).toBeUndefined();
  });
});
