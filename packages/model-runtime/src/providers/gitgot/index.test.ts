// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeGitGotAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeGitGotAI,
  bizErrorType: 'ProviderBizError',
  chatDebugEnv: 'DEBUG_GITGOT_CHAT_COMPLETION',
  chatModel: 'openai/gpt-oss-120b',
  defaultBaseURL: 'https://inference.gitgot.ai/v1',
  invalidErrorType: 'InvalidProviderAPIKey',
  provider: ModelProvider.GitGot,
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// One accepted field, three behaviours. Sending the same shape to all of them
// gives the user a control that silently does nothing on two thirds of the
// catalogue.
describe('gitgot reasoning payload', () => {
  const handle = params.chatCompletion!.handlePayload!;

  it('grades effort on gpt-oss', () => {
    const out = handle({
      messages: [],
      model: 'openai/gpt-oss-120b',
      reasoning_effort: 'xhigh',
    } as any) as any;
    expect(out.reasoning_effort).toBe('high');
  });

  it('defaults gpt-oss to medium when no effort is given', () => {
    const out = handle({ messages: [], model: 'openai/gpt-oss-120b' } as any) as any;
    expect(out.reasoning_effort).toBe('medium');
  });

  // On DeepSeek the field is the switch and the value is not read, so omitting
  // it is the only way to turn reasoning off.
  it('passes the value through untouched on DeepSeek', () => {
    const out = handle({
      messages: [],
      model: 'deepseek-ai/DeepSeek-V4-Pro',
      reasoning_effort: 'low',
    } as any) as any;
    expect(out.reasoning_effort).toBe('low');
  });

  it('omits the field entirely on DeepSeek when reasoning is off', () => {
    const out = handle({
      messages: [],
      model: 'deepseek-ai/DeepSeek-V4-Pro',
      thinking: { type: 'disabled' },
    } as any) as any;
    expect(out).not.toHaveProperty('reasoning_effort');
  });

  // Kimi reasons regardless; sending the field would imply otherwise.
  it('sends nothing on Kimi, which has no caller control', () => {
    const out = handle({
      messages: [],
      model: 'moonshotai/Kimi-K2.7-Code',
      reasoning_effort: 'high',
    } as any) as any;
    expect(out).not.toHaveProperty('reasoning_effort');
  });
});
