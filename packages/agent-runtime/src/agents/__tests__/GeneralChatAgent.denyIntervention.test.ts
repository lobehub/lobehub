import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * A shared Agent's Channel run has nobody to approve a tool (`denyIntervention`): tools that need
 * approval come back as blocked results the Agent can read, rather than parking the run or, as
 * `headless` would, running with the owner's credentials.
 */
describe('GeneralChatAgent — denyIntervention', () => {
  const createState = (overrides?: Partial<AgentState>): AgentState => ({
    cost: {
      calculatedAt: new Date().toISOString(),
      currency: 'USD',
      llm: { byModel: [], currency: 'USD', total: 0 },
      tools: { byTool: [], currency: 'USD', total: 0 },
      total: 0,
    },
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    messages: [],
    operationId: 'test-session',
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    usage: {
      humanInteraction: {
        approvalRequests: 0,
        promptRequests: 0,
        selectRequests: 0,
        totalWaitingTimeMs: 0,
      },
      llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
      tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
    },
    ...overrides,
  });

  const createContext = (toolsCalling: ChatToolPayload[]): AgentRuntimeContext => ({
    payload: { hasToolsCalling: true, parentMessageId: 'msg-1', toolsCalling },
    phase: 'llm_result',
    session: { messageCount: 0, sessionId: 'test-session', status: 'running', stepCount: 0 },
  });

  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

  const call = (id: string, identifier: string): ChatToolPayload => ({
    apiName: 'run',
    arguments: '{}',
    id,
    identifier,
    type: 'builtin',
  });
  const manifests = {
    free: { humanIntervention: 'never', identifier: 'free' },
    gated: { humanIntervention: 'required', identifier: 'gated' },
    locked: { humanIntervention: 'always', identifier: 'locked' },
  } as unknown as AgentState['toolManifestMap'];
  const deny = { approvalMode: 'manual', denyIntervention: true } as const;

  it('denies required and always tools, and still runs the free one', async () => {
    const [free, gated, locked] = [call('1', 'free'), call('2', 'gated'), call('3', 'locked')];
    const state = createState({ toolManifestMap: manifests, userInterventionConfig: deny });

    const result = await createAgent().runner(createContext([free, gated, locked]), state);

    expect(result).toEqual([
      { payload: { parentMessageId: 'msg-1', toolCalling: free }, type: 'call_tool' },
      {
        payload: {
          blockedContent: expect.stringContaining('nobody can approve it'),
          blockedReason: 'human_intervention_unavailable',
          parentMessageId: 'msg-1',
          toolsCalling: [gated, locked],
        },
        type: 'resolve_blocked_tools',
      },
    ]);
  });

  it('parks the same call for approval without the flag', async () => {
    const gated = call('2', 'gated');
    const state = createState({
      toolManifestMap: manifests,
      userInterventionConfig: { approvalMode: 'manual' },
    });

    const result = await createAgent().runner(createContext([gated]), state);

    expect(result).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [gated],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });
});
