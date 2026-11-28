import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * The llm_result branch for tool calls whose names resolve to nothing: the
 * model gets a rejected tool result to retry with, and only a model that keeps
 * missing on consecutive turns ends the run. The budget's reset on executed
 * tools and the end-to-end run status live in
 * `core/__tests__/runtime.unresolvedToolNames.test.ts`.
 */
describe('GeneralChatAgent unresolvable tool names (llm_result phase)', () => {
  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

  const createMockState = (overrides?: Partial<AgentState>): AgentState => ({
    operationId: 'test-session',
    status: 'running',
    messages: [],
    toolManifestMap: {},
    stepCount: 0,
    usage: {
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { totalCalls: 0, totalTimeMs: 0, byTool: [] },
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
    },
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    ...overrides,
  });

  const createMockContext = (
    phase: AgentRuntimeContext['phase'],
    payload?: any,
  ): AgentRuntimeContext => ({
    phase,
    payload,
    session: {
      sessionId: 'test-session',
      messageCount: 0,
      status: 'running',
      stepCount: 0,
    },
  });

  const unresolvedContext = (name: string) =>
    createMockContext('llm_result', {
      hasToolsCalling: true,
      toolsCalling: [],
      parentMessageId: 'msg-1',
      result: {
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: '{}' } }],
      },
    });

  it('should reject unresolvable tool_calls so the model can retry', async () => {
    const agent = createAgent();

    const state = createMockState();
    const context = createMockContext('llm_result', {
      hasToolsCalling: true,
      toolsCalling: [],
      parentMessageId: 'msg-1',
      result: {
        content: '',
        tool_calls: [
          { id: 't1', type: 'function', function: { name: 'activateTools', arguments: '{}' } },
          {
            id: 't2',
            type: 'function',
            function: { name: 'lobe-skills____activateSkill', arguments: '{"a":1}' },
          },
        ],
      },
    });

    const result = await agent.runner(context, state);

    expect(result).toEqual({
      type: 'resolve_blocked_tools',
      payload: {
        blockedContent:
          'Tool call rejected: no available tool is named activateTools, lobe-skills____activateSkill. Copy a name exactly as declared in the tools schema and call it again.',
        blockedReason: 'tool_name_unresolved',
        parentMessageId: 'msg-1',
        unresolvedToolNames: true,
        toolsCalling: [
          {
            apiName: 'activateTools',
            arguments: '{}',
            id: 't1',
            identifier: 'activateTools',
            type: 'builtin',
          },
          {
            apiName: 'activateSkill',
            arguments: '{"a":1}',
            id: 't2',
            identifier: 'lobe-skills',
            type: 'builtin',
          },
        ],
      },
    });
  });

  it('should keep retrying while the consecutive rounds are under the limit', async () => {
    const result = await createAgent().runner(
      unresolvedContext('lobe-skills____executeCode'),
      createMockState({ unresolvedToolFeedbackRounds: 1 }),
    );

    expect((result as any).type).toBe('resolve_blocked_tools');
  });

  // T-14100: the third consecutive miss used to throw, which marked the whole
  // operation `error` (an "Agent Execution Failed" 500) and discarded a run
  // that had already produced work.
  it('should finish as done, not throw, once consecutive rejections hit the limit', async () => {
    const result = await createAgent().runner(
      unresolvedContext('lobe-skills____executeCode'),
      createMockState({ unresolvedToolFeedbackRounds: 2 }),
    );

    expect(result).toEqual([
      {
        type: 'resolve_blocked_tools',
        payload: {
          blockedContent:
            'Tool call rejected: no available tool is named lobe-skills____executeCode. Copy a name exactly as declared in the tools schema and call it again.' +
            '\n\n' +
            'Stopped after 3 consecutive replies called tools that do not exist.',
          blockedReason: 'tool_name_unresolved',
          parentNote: 'Stopped after 3 consecutive replies called tools that do not exist.',
          parentMessageId: 'msg-1',
          unresolvedToolNames: true,
          toolsCalling: [
            {
              apiName: 'executeCode',
              arguments: '{}',
              id: 't1',
              identifier: 'lobe-skills',
              type: 'builtin',
            },
          ],
        },
      },
      {
        type: 'finish',
        reason: 'tool_name_unresolved',
        reasonDetail:
          'LLM returned 1 unresolvable tool_calls after 2 consecutive rejected rounds: lobe-skills____executeCode',
      },
    ]);
  });

  // Gemini 3.x 400s on the next tool-call turn unless `thoughtSignature` is
  // round-tripped, which would kill the retry the rejection exists to enable.
  it('should keep the thought signature of an unresolvable tool call', async () => {
    const context = createMockContext('llm_result', {
      hasToolsCalling: true,
      toolsCalling: [],
      parentMessageId: 'msg-1',
      result: {
        content: '',
        tool_calls: [
          {
            id: 't1',
            type: 'function',
            function: { name: 'activateTools', arguments: '{}' },
            thoughtSignature: 'EoMYCoAYA_gemini3_thought_signature_fixture',
          },
        ],
      },
    });

    const result = await createAgent().runner(context, createMockState());

    expect((result as any).payload.toolsCalling[0]).toEqual(
      expect.objectContaining({
        id: 't1',
        thoughtSignature: 'EoMYCoAYA_gemini3_thought_signature_fixture',
      }),
    );
  });

  it('should finish instead of retrying unresolvable tool_calls past max steps', async () => {
    const result = await createAgent().runner(
      unresolvedContext('activateTools'),
      createMockState({ forceFinish: true }),
    );

    expect(result).toEqual({
      type: 'finish',
      reason: 'max_steps_completed',
      reasonDetail: 'LLM returned 1 unresolvable tool_calls after max steps: activateTools',
    });
  });

  // forceFinish wins over the feedback limit: past max steps the run ends
  // with the max-steps reason whatever the rejection count is.
  it('should keep the max-steps finish when the feedback limit is also reached', async () => {
    const result = await createAgent().runner(
      unresolvedContext('activateTools'),
      createMockState({ forceFinish: true, unresolvedToolFeedbackRounds: 2 }),
    );

    expect(result).toEqual({
      type: 'finish',
      reason: 'max_steps_completed',
      reasonDetail: 'LLM returned 1 unresolvable tool_calls after max steps: activateTools',
    });
  });

  // The message history is rehydrated from the DB every step and carries
  // rejections written by earlier operations, so the budget has to be
  // operation-scoped state rather than a count of matching tool rows.
  it('should not spend the budget on rejections from earlier operations', async () => {
    const rejection = {
      content:
        'Tool call rejected: no available tool is named activateTools. Copy a name exactly as declared in the tools schema and call it again.',
      role: 'tool' as const,
    };
    const state = createMockState({
      messages: [
        { ...rejection, id: 'tool-1', tool_call_id: 'old-1' },
        { ...rejection, id: 'tool-2', tool_call_id: 'old-2' },
      ] as AgentState['messages'],
    });

    const result = await createAgent().runner(unresolvedContext('activateTools'), state);

    expect((result as any).type).toBe('resolve_blocked_tools');
  });

  // lobehub#23684: in agent mode an on-demand builtin such as Agent Management
  // stays out of the offered tools until `activateTools` loads it, even when
  // the agent enables it. A model that calls its exact name before activating
  // it (an earlier turn used it, but that turn's activation fell out of the
  // history window) was told to "copy a name exactly", repeated the same exact
  // name, and the run stopped after three misses.
  describe('when the tool exists but is not activated', () => {
    const activatorTool = {
      function: { name: 'lobe-activator____activateTools', parameters: {} },
      type: 'function',
    };
    const agentManagementManifest = {
      api: [{ name: 'createAgent' }, { name: 'callAgent' }],
      identifier: 'lobe-agent-management',
    };
    const activatableState = (overrides?: Partial<AgentState>) =>
      createMockState({
        operationToolSet: {
          enabledToolIds: ['lobe-activator'],
          manifestMap: { 'lobe-agent-management': agentManagementManifest },
          sourceMap: {},
          tools: [activatorTool],
        },
        ...overrides,
      } as Partial<AgentState>);

    it('should tell the model to activate the tool instead of copying the name', async () => {
      const result = await createAgent().runner(
        unresolvedContext('lobe-agent-management____createAgent'),
        activatableState(),
      );

      expect((result as any).payload.blockedContent).toBe(
        'Tool call rejected: lobe-agent-management____createAgent is not activated in this run. Call lobe-activator____activateTools with identifiers ["lobe-agent-management"] first, then call it again.',
      );
    });

    it('should keep the typo feedback for an API the tool does not declare', async () => {
      const result = await createAgent().runner(
        unresolvedContext('lobe-agent-management____cloneAgent'),
        activatableState(),
      );

      expect((result as any).payload.blockedContent).toBe(
        'Tool call rejected: no available tool is named lobe-agent-management____cloneAgent. Copy a name exactly as declared in the tools schema and call it again.',
      );
    });

    it('should keep the typo feedback when the run offers no activator', async () => {
      const result = await createAgent().runner(
        unresolvedContext('lobe-agent-management____createAgent'),
        activatableState({
          operationToolSet: {
            enabledToolIds: [],
            manifestMap: { 'lobe-agent-management': agentManagementManifest },
            sourceMap: {},
            tools: [],
          },
        } as Partial<AgentState>),
      );

      expect((result as any).payload.blockedContent).toContain('no available tool is named');
    });
  });

  it('should fail when unresolvable tool_calls carry no name to reject', async () => {
    await expect(createAgent().runner(unresolvedContext(''), createMockState())).rejects.toThrow(
      'LLM returned 1 unresolvable tool_calls: unnamed',
    );
  });
});
