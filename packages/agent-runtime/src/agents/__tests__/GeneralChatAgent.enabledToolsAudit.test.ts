import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

describe('GeneralChatAgent — audits see the tools the run already offers', () => {
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

  const seen: Record<string, any>[] = [];
  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      dynamicInterventionAudits: {
        offeredOnly: async (toolArgs, metadata) => {
          seen.push(metadata ?? {});
          return !(metadata?.enabledToolIds ?? []).includes(toolArgs.identifier);
        },
      },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

  const activator = {
    api: [
      {
        humanIntervention: {
          dynamic: { default: 'never', policy: 'required', type: 'offeredOnly' },
        },
        name: 'activateTools',
      },
    ],
    identifier: 'lobe-activator',
  };

  const activate = (identifier: string): ChatToolPayload => ({
    apiName: 'activateTools',
    arguments: JSON.stringify({ identifier }),
    id: `call-${identifier}`,
    identifier: 'lobe-activator',
    type: 'builtin',
  });

  const stateWith = (overrides?: Partial<AgentState>) =>
    createState({
      operationToolSet: {
        enabledToolIds: ['builtin-artboard'],
        manifestMap: { 'lobe-activator': activator },
        tools: [],
      },
      userInterventionConfig: { allowList: [], approvalMode: 'manual' },
      ...overrides,
    } as Partial<AgentState>);

  it('runs a call whose audit finds its target among the enabled tools', async () => {
    const call = activate('builtin-artboard');
    const result = await createAgent().runner(createContext([call]), stateWith());

    expect(result).toEqual([
      { payload: { parentMessageId: 'msg-1', toolCalling: call }, type: 'call_tool' },
    ]);
  });

  it('counts tools activated at step level as enabled', async () => {
    const call = activate('lobe-web-browsing');
    const result = await createAgent().runner(
      createContext([call]),
      stateWith({ activatedStepTools: [{ id: 'lobe-web-browsing' }] } as Partial<AgentState>),
    );

    expect(result).toEqual([
      { payload: { parentMessageId: 'msg-1', toolCalling: call }, type: 'call_tool' },
    ]);
  });

  it('asks for a call whose target the run does not offer', async () => {
    const call = activate('lobe-notebook');
    const result = await createAgent().runner(createContext([call]), stateWith());

    expect(result).toEqual([
      {
        parentMessageId: 'msg-1',
        pendingToolsCalling: [call],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
    expect(seen.at(-1)?.enabledToolIds).toEqual(['builtin-artboard']);
  });
});
