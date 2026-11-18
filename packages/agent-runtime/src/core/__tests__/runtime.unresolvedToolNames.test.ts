import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { GeneralChatAgent } from '../../agents/GeneralChatAgent';
import { createAgentRuntimeExecutors } from '../../executors/registry';
import { callTool } from '../../executors/tool';
import { createState, createToolExecutorFixture } from '../../executors/tool.testUtils';
import type { AgentEvent, AgentRuntimeContext, AgentState, InstructionExecutor } from '../../types';
import { AgentRuntime } from '../runtime';

/**
 * T-14100: a long run that had already produced work ended as an `error`
 * ("Agent Execution Failed") because the unresolved-tool-name budget counted
 * every miss in the operation, so two early misses plus one late typo — with
 * many successful tool calls in between — spent it and the agent threw.
 *
 * These replay the model's turns through the real runtime, agent and the
 * package's own executors (only the LLM is scripted), and assert how the
 * operation ends.
 */

type LlmReply =
  | { kind: 'text' }
  | { kind: 'tools'; calls: ChatToolPayload[] }
  | { kind: 'unresolved'; name: string };

const runCommandCall = (id: string): ChatToolPayload => ({
  apiName: 'runCommand',
  arguments: '{"command":"ls"}',
  id,
  identifier: 'lobe-skills',
  type: 'builtin',
});

const toolManifestMap = {
  'lobe-skills': {
    api: [{ description: '', humanIntervention: 'never', name: 'runCommand', parameters: {} }],
    identifier: 'lobe-skills',
    meta: {},
    type: 'builtin',
  },
} as any;

const llmResultContext = (reply: LlmReply, index: number): AgentRuntimeContext => {
  const parentMessageId = `assistant-${index}`;
  const session = { messageCount: 1, sessionId: 'op-1', status: 'running' as const, stepCount: 0 };

  if (reply.kind === 'text') {
    return {
      payload: { hasToolsCalling: false, parentMessageId, result: { content: 'Done.' } },
      phase: 'llm_result',
      session,
    };
  }

  const toolCalls =
    reply.kind === 'tools'
      ? reply.calls.map((call) => ({ id: call.id, name: `${call.identifier}____${call.apiName}` }))
      : [{ id: `call-${index}`, name: reply.name }];

  return {
    payload: {
      hasToolsCalling: reply.kind === 'tools',
      parentMessageId,
      result: {
        content: '',
        tool_calls: toolCalls.map(({ id, name }) => ({
          function: { arguments: '{}', name },
          id,
          type: 'function',
        })),
      },
      toolsCalling: reply.kind === 'tools' ? reply.calls : [],
    },
    phase: 'llm_result',
    session,
  };
};

const replay = async (replies: LlmReply[]) => {
  const fixture = createToolExecutorFixture();
  let llmTurn = 0;
  // Only the model is scripted; every other instruction runs the package's
  // real executor against an in-memory host.
  const callLlm: InstructionExecutor = async (_instruction, state) => {
    const reply = replies[llmTurn];
    if (!reply) throw new Error(`LLM called more times than scripted (${llmTurn + 1})`);
    llmTurn += 1;
    return {
      events: [],
      newState: structuredClone(state),
      nextContext: llmResultContext(reply, llmTurn),
    };
  };

  const agent = new GeneralChatAgent({
    agentConfig: { maxSteps: 100 },
    modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
    operationId: 'op-1',
  });
  const runtime = new AgentRuntime(agent, {
    executors: { ...createAgentRuntimeExecutors(fixture.host), call_llm: callLlm },
  });

  let state: AgentState = createState({
    messages: [{ content: 'Build the report', id: 'msg-user', role: 'user' }],
    toolManifestMap,
  });
  let context: AgentRuntimeContext | undefined = {
    payload: {},
    phase: 'user_input',
    session: { messageCount: 1, sessionId: 'op-1', status: 'running', stepCount: 0 },
  };
  const events: AgentEvent[] = [];

  for (let step = 0; context && state.status === 'running' && step < 30; step++) {
    const result = await runtime.step(state, context);
    events.push(...result.events);
    state = result.newState;
    context = result.nextContext;
  }

  return { events, fixture, llmTurns: llmTurn, state };
};

describe('AgentRuntime with unresolvable tool names', () => {
  it('keeps going when a typo follows two misses with a successful tool call in between', async () => {
    const { events, fixture, llmTurns, state } = await replay([
      { kind: 'unresolved', name: 'lobe-cloud-sandbox____writeFile' },
      { kind: 'unresolved', name: 'lobe-cloud-sandbox____runCommand' },
      { kind: 'tools', calls: [runCommandCall('call-ok')] },
      { kind: 'unresolved', name: 'lobe-skills____executeCode' },
      { kind: 'text' },
    ]);

    expect(state.status).toBe('done');
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ reason: 'completed', type: 'done' });
    // The late typo still got its rejection, and the model used it to answer.
    expect(llmTurns).toBe(5);
    expect(fixture.runTool).toHaveBeenCalledTimes(1);
    expect(state.unresolvedToolFeedbackRounds).toBe(1);
  });

  it('ends as done with a tool_name_unresolved reason after three consecutive misses', async () => {
    const { events, fixture, llmTurns, state } = await replay([
      { kind: 'tools', calls: [runCommandCall('call-ok')] },
      { kind: 'unresolved', name: 'lobe-skills____executeCode' },
      { kind: 'unresolved', name: 'lobe-skills____executeCode' },
      { kind: 'unresolved', name: 'lobe-skills____executeCode' },
    ]);

    expect(state.status).toBe('done');
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      reason: 'tool_name_unresolved',
      reasonDetail:
        'LLM returned 1 unresolvable tool_calls after 2 consecutive rejected rounds: lobe-skills____executeCode',
      type: 'done',
    });
    expect(llmTurns).toBe(4);
    // The final turn's call is still answered with a rejected row, so the
    // persisted history stays well-formed for the next operation.
    const rejectedRows = fixture.createToolMessage.mock.calls.filter(
      ([params]) => params.pluginIntervention?.status === 'rejected',
    );
    expect(rejectedRows).toHaveLength(3);
    expect(rejectedRows.at(-1)?.[0].content).toContain(
      'Stopped after 3 consecutive replies called tools that do not exist.',
    );
    // A rejected card shows only its reason code, so the reply carries the
    // human-readable stop note; earlier rejections leave the reply alone.
    const replyUpdates = (fixture.host.transports.messages.update as any).mock.calls;
    expect(replyUpdates.filter(([, params]: any) => 'content' in params)).toEqual([
      [
        'assistant-4',
        expect.objectContaining({
          content: 'Stopped after 3 consecutive replies called tools that do not exist.',
        }),
      ],
    ]);
  });

  it('resets the count when a batch of resolved tools runs', async () => {
    const { fixture, state } = await replay([
      { kind: 'unresolved', name: 'lobe-cloud-sandbox____writeFile' },
      { kind: 'unresolved', name: 'lobe-cloud-sandbox____runCommand' },
      { kind: 'tools', calls: [runCommandCall('call-a'), runCommandCall('call-b')] },
      { kind: 'text' },
    ]);

    expect(state.status).toBe('done');
    expect(fixture.runTool).toHaveBeenCalledTimes(2);
    expect(state.unresolvedToolFeedbackRounds).toBe(0);
  });

  // The reset happens on executor entry, so a call that fails (or parks for a
  // sub-agent / client) still proves the model named a real tool.
  it('resets the count even when the resolved tool throws', async () => {
    const fixture = createToolExecutorFixture();
    fixture.runTool.mockRejectedValueOnce(new Error('sandbox unreachable'));

    const result = await callTool(fixture.host)(
      {
        payload: { parentMessageId: 'assistant-1', toolCalling: runCommandCall('call-1') },
        type: 'call_tool',
      },
      createState({ toolManifestMap, unresolvedToolFeedbackRounds: 2 }),
    );

    expect(result.events.some((event) => event.type === 'error')).toBe(true);
    expect(result.newState.unresolvedToolFeedbackRounds).toBe(0);
  });
});
