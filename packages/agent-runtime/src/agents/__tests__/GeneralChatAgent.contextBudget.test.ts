import { describe, expect, it } from 'vitest';

import { AgentRuntime } from '../../core';
import type { AgentRuntimeContext } from '../../types';
import { GeneralChatAgent } from '../GeneralChatAgent';

const createInitContext = (): AgentRuntimeContext => ({
  payload: { message: [{ content: 'Continue' }] },
  phase: 'init',
  session: {
    messageCount: 1,
    sessionId: 'test-session',
    status: 'idle',
    stepCount: 0,
  },
});

describe('GeneralChatAgent context budget accounting', () => {
  it('includes recorded contextAccounting.system from the latest assistant turn in the compression budget', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      compressionConfig: {
        enabled: true,
        maxWindowToken: 100_000,
        thresholdRatio: 0.5,
      },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

    // 35,000 conversation tokens alone (adjusted 43,750) fit under the 50,000 threshold,
    // but adding 8,000 recorded system tokens (raw 43,000 -> adjusted 53,750) crosses it.
    const state = {
      ...AgentRuntime.createInitialState({ operationId: 'test-session' }),
      messages: [
        {
          content: 'reply',
          metadata: {
            contextAccounting: {
              bySource: {
                content: 100,
                fileContext: 0,
                reasoning: 0,
                thoughtSignature: 0,
                toolCallId: 0,
                toolCalls: 0,
                toolDefinition: 0,
              },
              estimator: 'tokenx',
              messageCount: 2,
              system: 8000,
              total: 8100,
            },
            usage: { totalOutputTokens: 35_000 },
          },
          role: 'assistant',
        },
      ] as any,
    };

    const result = (await agent.runner(createInitContext(), state)) as any;

    expect(result.type).toBe('compress_context');
    expect(result.payload.currentTokenCount).toBe(43_000);
  });

  it('does not trigger premature compression when large outputReasoningTokens were stripped', async () => {
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 100 },
      compressionConfig: {
        enabled: true,
        maxWindowToken: 100_000,
        thresholdRatio: 0.5,
      },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'test-session',
    });

    // totalOutputTokens is 45,000 (which * 1.25 = 56,250 > 50,000 threshold),
    // but 30,000 of those were reasoning tokens not present on the message.
    const state = {
      ...AgentRuntime.createInitialState({ operationId: 'test-session' }),
      messages: [
        {
          content: 'concise final answer',
          metadata: {
            usage: {
              outputReasoningTokens: 30_000,
              totalOutputTokens: 45_000,
            },
          },
          role: 'assistant',
        },
      ] as any,
    };

    const result = (await agent.runner(createInitContext(), state)) as any;

    expect(result.type).toBe('call_llm');
  });
});
