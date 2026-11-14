import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * A remote-device picker call on a run that withholds the picker is not a typo:
 * the run has no device (`none` / `sandbox`), or device access is denied. The
 * rejection must say why, and must only point at the device selector when the
 * caller can actually use one.
 */
describe('GeneralChatAgent withheld device picker (llm_result phase)', () => {
  const mockModelRuntimeConfig = {
    model: 'gpt-4o-mini',
    provider: 'openai',
  };

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
      // Note: AgentRuntimeContext.session uses sessionId for backward compatibility
      sessionId: 'test-session',
      messageCount: 0,
      status: 'running',
      stepCount: 0,
    },
  });

  it.each([
    {
      expected: 'runs in the cloud sandbox',
      name: 'a sandbox run',
      principal: undefined,
      selector: true,
    },
    {
      expected: 'not available in this conversation',
      name: 'a run denied device access',
      principal: { policy: { deviceAccess: { canUseDevice: false } } },
      selector: false,
    },
  ])('explains a picker call on $name instead of typo feedback', async (c) => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      operationId: 'test-session',
      modelRuntimeConfig: mockModelRuntimeConfig,
    });

    const state = createMockState({
      plan: {
        execution: c.principal
          ? { kind: 'none', target: 'none' }
          : { kind: 'sandbox', target: 'sandbox' },
      },
      ...(c.principal && { principal: c.principal }),
    } as Partial<AgentState>);
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
            function: { name: 'lobe-remote-device____listOnlineDevices', arguments: '{}' },
          },
        ],
      },
    });

    const result = (await agent.runner(context, state)) as any;

    expect(result.type).toBe('resolve_blocked_tools');
    expect(result.payload.blockedContent).toContain(c.expected);
    expect(result.payload.blockedContent.includes('device selector')).toBe(c.selector);
    expect(result.payload.blockedContent).not.toContain('Copy a name exactly');
  });
});
