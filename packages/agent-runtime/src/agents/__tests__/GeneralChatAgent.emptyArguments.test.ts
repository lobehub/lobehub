import { type ChatToolPayload } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type AgentRuntimeContext, type AgentState } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * Scenario tests for the empty-arguments pre-check on the llm_result phase:
 * which calls get normalized to a legal no-argument `{}` call and which get
 * rejected as the T-673 serialization-loss shape (vent T-800). Pure-helper
 * unit tests live beside the module in `utils/emptyArgumentsCalls.test.ts`.
 */
describe('GeneralChatAgent empty-arguments handling (llm_result phase)', () => {
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

  it('keeps a legal no-argument call executable (arguments "{}" is not the loss shape)', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      operationId: 'test-session',
      modelRuntimeConfig: mockModelRuntimeConfig,
    });

    const noArgsCall = {
      apiName: 'listCriteria',
      arguments: '{}',
      id: 'call-1',
      identifier: 'lobe-acceptance-evidence',
      type: 'builtin',
    } as unknown as ChatToolPayload;

    const result = await agent.runner(
      createMockContext('llm_result', {
        hasToolsCalling: true,
        parentMessageId: 'msg-1',
        toolsCalling: [noArgsCall],
      }),
      createMockState({
        toolManifestMap: {
          'lobe-acceptance-evidence': { identifier: 'lobe-acceptance-evidence' },
        },
      }),
    );

    expect(result).toEqual([
      {
        type: 'call_tool',
        payload: {
          parentMessageId: 'msg-1',
          toolCalling: noArgsCall,
        },
      },
    ]);
  });

  it('executes a no-required-parameter tool whose arguments field was omitted (vent T-800)', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      operationId: 'test-session',
      modelRuntimeConfig: mockModelRuntimeConfig,
    });

    // The T-800 shape: several provider/gateway serialization paths drop an
    // empty arguments string entirely, so the call arrives with no
    // `arguments` field at all. For a tool whose schema has no required
    // properties this is a legal no-argument call, not the T-673 loss shape.
    const omittedArgsCall = {
      apiName: 'listCriteria',
      id: 'call-1',
      identifier: 'lobe-acceptance-evidence',
      type: 'builtin',
    } as unknown as ChatToolPayload;

    const result = await agent.runner(
      createMockContext('llm_result', {
        hasToolsCalling: true,
        parentMessageId: 'msg-1',
        toolsCalling: [omittedArgsCall],
      }),
      createMockState({
        toolManifestMap: {
          'lobe-acceptance-evidence': {
            api: [{ name: 'listCriteria', parameters: { properties: {}, type: 'object' } }],
            identifier: 'lobe-acceptance-evidence',
          },
        },
      }),
    );

    expect(result).toEqual([
      {
        type: 'call_tool',
        payload: {
          parentMessageId: 'msg-1',
          toolCalling: { ...omittedArgsCall, arguments: '{}' },
        },
      },
    ]);
  });

  it('resolves a no-required-parameter tool manifest only exposed via activatedStepTools (Codex P2 on PR #21013)', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      operationId: 'test-session',
      modelRuntimeConfig: mockModelRuntimeConfig,
    });

    // Regression for the Codex P2 gap fix: the static map has no entry for
    // this tool — it is only exposed through step-activated manifests, the
    // same lookup shape `executors/tool.ts` uses at execution time.
    const omittedArgsCall = {
      apiName: 'listCriteria',
      id: 'call-1',
      identifier: 'lobe-acceptance-evidence',
      type: 'builtin',
    } as unknown as ChatToolPayload;

    const result = await agent.runner(
      createMockContext('llm_result', {
        hasToolsCalling: true,
        parentMessageId: 'msg-1',
        toolsCalling: [omittedArgsCall],
      }),
      createMockState({
        activatedStepTools: [
          {
            id: 'lobe-acceptance-evidence',
            manifest: {
              api: [{ name: 'listCriteria', parameters: { properties: {}, type: 'object' } }],
              identifier: 'lobe-acceptance-evidence',
            },
          },
        ],
      } as unknown as Partial<AgentState>),
    );

    expect(result).toEqual([
      {
        type: 'call_tool',
        payload: {
          parentMessageId: 'msg-1',
          toolCalling: { ...omittedArgsCall, arguments: '{}' },
        },
      },
    ]);
  });

  it('still rejects an empty-arguments call to a tool with required parameters', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      operationId: 'test-session',
      modelRuntimeConfig: mockModelRuntimeConfig,
    });

    const requiredArgsCall = {
      apiName: 'submitEvidence',
      arguments: '',
      id: 'call-1',
      identifier: 'lobe-acceptance-evidence',
      type: 'builtin',
    } as unknown as ChatToolPayload;

    const result = await agent.runner(
      createMockContext('llm_result', {
        hasToolsCalling: true,
        parentMessageId: 'msg-1',
        toolsCalling: [requiredArgsCall],
      }),
      createMockState({
        toolManifestMap: {
          'lobe-acceptance-evidence': {
            api: [
              {
                name: 'submitEvidence',
                parameters: {
                  properties: { content: { type: 'string' } },
                  required: ['content'],
                  type: 'object',
                },
              },
            ],
            identifier: 'lobe-acceptance-evidence',
          },
        },
      }),
    );

    expect(result).toEqual([
      {
        payload: {
          blockedContent: expect.stringContaining('arguments of this call arrived empty'),
          blockedReason: 'tool_arguments_empty',
          parentMessageId: 'msg-1',
          toolsCalling: [requiredArgsCall],
        },
        type: 'resolve_blocked_tools',
      },
    ]);
  });
});
