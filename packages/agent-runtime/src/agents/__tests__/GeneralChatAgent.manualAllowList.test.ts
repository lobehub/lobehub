import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * "Approve, and don't ask again for similar actions" puts a tool on the
 * user's allow-list. Manual mode honours it like allow-list mode does, but a
 * call that must always ask is never skipped.
 */
describe('GeneralChatAgent — remembered tools in manual mode', () => {
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

  const bash: ChatToolPayload = {
    apiName: 'bash',
    arguments: '{"command":"ls"}',
    id: 'call-1',
    identifier: 'bash',
    type: 'builtin',
  };

  it('runs a remembered tool without asking', async () => {
    const state = createState({
      toolManifestMap: { bash: { humanIntervention: 'required', identifier: 'bash' } },
      userInterventionConfig: { allowList: ['bash/bash'], approvalMode: 'manual' },
    });

    const result = await createAgent().runner(createContext([bash]), state);

    expect(result).toEqual([
      { payload: { parentMessageId: 'msg-1', toolCalling: bash }, type: 'call_tool' },
    ]);
  });

  it('still asks for a tool that is not remembered', async () => {
    const state = createState({
      toolManifestMap: { bash: { humanIntervention: 'required', identifier: 'bash' } },
      userInterventionConfig: { allowList: [], approvalMode: 'manual' },
    });

    const result = await createAgent().runner(createContext([bash]), state);

    expect(result).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [bash],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });

  it('never skips a call that must always ask, even when remembered', async () => {
    const state = createState({
      toolManifestMap: { bash: { humanIntervention: 'always', identifier: 'bash' } },
      userInterventionConfig: { allowList: ['bash/bash'], approvalMode: 'manual' },
    });

    const result = await createAgent().runner(createContext([bash]), state);

    expect(result).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [bash],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });
});
