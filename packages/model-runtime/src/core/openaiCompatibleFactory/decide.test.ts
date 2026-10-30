// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DecisionPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { createOpenAICompatibleRuntime } from './index';

// Price from the real OpenRouter cards so the test also covers the decision card's pricing.
vi.mock('@lobechat/business-model-bank/model-config', async () => {
  const { default: openrouterModels } = await import('model-bank/openrouter');
  return {
    loadModels: async () =>
      openrouterModels.map((model) => ({ ...model, providerId: 'openrouter' })),
  };
});

const DecideRuntime = createOpenAICompatibleRuntime({
  baseURL: 'https://openrouter.ai/api/v1',
  decide: { path: '/systemone', protocol: 'systemone' },
  provider: 'openrouter',
});

const createInstance = () => new DecideRuntime({ apiKey: 'test-key' });

const payload = {
  model: 'typesafe/jev-1.13',
  questions: {
    intent: {
      criteria: { billing: 'Payment problems.', other: 'Anything else.' },
      instructions: 'What is the ticket about?',
      type: 'choice',
    },
    refund: {
      criteria: { false: 'No refund requested.', true: 'Asks for money back.' },
      instructions: 'Is the customer asking for a refund?',
      type: 'boolean',
    },
    urgency: {
      criteria: ['Low', 'Medium', 'High'],
      instructions: 'How urgent is the ticket?',
      type: 'score',
    },
  },
  state: 'I was charged twice and want my money back today.',
} satisfies DecisionPayload;

const systemOneResponse = {
  answers: {
    intent: {
      choice: 'billing',
      confidence: 0.93,
      probabilities: { billing: 0.97, other: 0.03 },
      type: 'choice',
    },
    refund: { noul: 0.99, type: 'noul' },
    urgency: {
      confidence: 0.5,
      legend: { '0': 'Low', '1': 'Medium', '2': 'High' },
      probabilities: { '0': 0.05, '1': 0.25, '2': 0.7 },
      score: 1.65,
      type: 'score',
    },
  },
  id: 'gen-1',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  usage: { cost: 0.000_018, input_tokens: 436, output_tokens: 71 },
};

describe('decide via System One', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is only installed for providers that configure a decision endpoint', () => {
    const PlainRuntime = createOpenAICompatibleRuntime({
      baseURL: 'https://api.test.com/v1',
      provider: 'test-provider',
    });

    expect(new PlainRuntime({ apiKey: 'test-key' }).decide).toBeUndefined();
    expect(createInstance().decide).toBeTypeOf('function');
  });

  it('sends System One questions without SDK retries and maps answers back', async () => {
    const instance = createInstance();
    const post = vi.spyOn(instance['client'], 'post').mockResolvedValue(systemOneResponse as never);

    const result = await instance.decide!(payload, { user: 'user-1' });

    expect(post).toHaveBeenCalledWith(
      '/systemone',
      expect.objectContaining({
        body: {
          model: 'typesafe/jev-1.13',
          questions: {
            ...payload.questions,
            refund: { ...payload.questions.refund, type: 'noul' },
          },
          state: payload.state,
          user: 'user-1',
        },
        maxRetries: 0,
      }),
    );
    expect(result).toEqual({
      answers: {
        intent: {
          choice: 'billing',
          confidence: 0.93,
          probabilities: { billing: 0.97, other: 0.03 },
          type: 'choice',
        },
        refund: { probability: 0.99, type: 'boolean' },
        urgency: { confidence: 0.5, probabilities: [0.05, 0.25, 0.7], score: 1.65, type: 'score' },
      },
      id: 'gen-1',
      model: 'typesafe/jev-1.13-20260917',
      provider: 'TypeSafe',
      usage: expect.objectContaining({ totalTokens: 507 }),
    });
  });

  it('returns usage priced on input tokens only and passes the same usage to onUsage', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue(systemOneResponse as never);
    const onUsage = vi.fn();

    const { usage } = await instance.decide!(payload, { onUsage });

    expect(onUsage).toHaveBeenCalledWith(usage);
    expect(usage).toMatchObject({
      inputTextTokens: 436,
      outputTextTokens: 71,
      totalInputTokens: 436,
      totalTokens: 507,
    });
    // 436 input tokens × $0.042/M = 18.3 credits, ceiled to whole credits; the 71 output tokens are free.
    expect(usage?.cost).toBe(0.000_019);
  });

  it('passes the provider-reported charge separately without touching usage or the response', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue(systemOneResponse as never);
    const onProviderReportedCost = vi.fn();

    const result = await instance.decide!(payload, { onProviderReportedCost });

    expect(onProviderReportedCost).toHaveBeenCalledWith(0.000_018);
    // `usage.cost` stays the model-bank price (19 credits), not OpenRouter's 0.000018.
    expect(result.usage?.cost).toBe(0.000_019);
    expect(JSON.stringify(result)).not.toContain('0.000018');
    expect(Object.keys(result).sort()).toEqual(['answers', 'id', 'model', 'provider', 'usage']);
  });

  it.each([
    ['missing', undefined],
    ['negative', -1],
    ['non-numeric', 'free'],
  ])('ignores a %s provider-reported charge without failing the decision', async (_, cost) => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...systemOneResponse,
      usage: { ...systemOneResponse.usage, cost },
    } as never);
    const onProviderReportedCost = vi.fn();

    const result = await instance.decide!(payload, { onProviderReportedCost });

    expect(onProviderReportedCost).not.toHaveBeenCalled();
    expect(result.usage?.cost).toBe(0.000_019);
  });

  it('returns usage without an onUsage callback', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue(systemOneResponse as never);

    const result = await instance.decide!(payload);

    expect(result.usage).toMatchObject({ cost: 0.000_019, totalTokens: 507 });
  });

  it('omits probabilities when the provider does not report a distribution', async () => {
    const instance = createInstance();
    const { probabilities: _, ...intent } = systemOneResponse.answers.intent;
    const { probabilities: __, ...urgency } = systemOneResponse.answers.urgency;
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...systemOneResponse,
      answers: { ...systemOneResponse.answers, intent, urgency },
    } as never);

    const result = await instance.decide!(payload);

    expect(result.answers.intent).toEqual({ choice: 'billing', confidence: 0.93, type: 'choice' });
    expect(result.answers.urgency).toEqual({ confidence: 0.5, score: 1.65, type: 'score' });
  });

  it('forwards boolean questions without criteria and structured guidance as-is', async () => {
    const instance = createInstance();
    const post = vi.spyOn(instance['client'], 'post').mockResolvedValue({
      answers: {
        intent: { choice: 'billing', type: 'choice' },
        refund: { noul: 0.8, type: 'noul' },
      },
      model: 'typesafe/jev-1.13',
    } as never);
    const questions = {
      intent: {
        criteria: { billing: { examples: ['charged twice'] }, other: null },
        instructions: { task: 'Classify the ticket', tone: 'strict' },
        type: 'choice',
      },
      refund: { instructions: 'Is the customer asking for a refund?', type: 'boolean' },
    } satisfies DecisionPayload['questions'];

    const result = await instance.decide!({ model: 'typesafe/jev-1.13', questions, state: 'x' });

    expect(post.mock.calls[0][1]).toMatchObject({
      body: { questions: { ...questions, refund: { ...questions.refund, type: 'noul' } } },
    });
    expect(result.answers.refund).toEqual({ probability: 0.8, type: 'boolean' });
  });

  it('returns a refusal as an answer instead of failing the whole call', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...systemOneResponse,
      answers: { ...systemOneResponse.answers, intent: { reason: 'unsafe', type: 'refusal' } },
    } as never);

    const result = await instance.decide!(payload);

    expect(result.answers.intent).toEqual({ reason: 'unsafe', type: 'refusal' });
    expect(result.answers.refund).toEqual({ probability: 0.99, type: 'boolean' });
  });

  it.each([
    [
      'a choice outside the requested options',
      { intent: { ...systemOneResponse.answers.intent, choice: 'shipping' } },
    ],
    [
      'a choice without a probability for every option',
      { intent: { ...systemOneResponse.answers.intent, probabilities: { billing: 1 } } },
    ],
    [
      'a score without a probability for every level',
      {
        urgency: {
          ...systemOneResponse.answers.urgency,
          probabilities: { '0': 0.3, '1': 0.7 },
        },
      },
    ],
    ['an answer of the wrong type', { refund: systemOneResponse.answers.intent }],
    ['a missing answer', { refund: undefined }],
  ])('rejects %s as a provider error', async (_, answers) => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...systemOneResponse,
      // An `undefined` override drops that answer from the response entirely.
      answers: Object.fromEntries(
        Object.entries({ ...systemOneResponse.answers, ...answers }).filter(
          ([, answer]) => answer !== undefined,
        ),
      ),
    } as never);
    const onUsage = vi.fn();

    await expect(instance.decide!(payload, { onUsage })).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: 'openrouter',
    });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('rejects a missing probability for an option named like an object method', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      answers: {
        pick: { choice: 'other', probabilities: { other: 1 }, type: 'choice' },
      },
      model: 'typesafe/jev-1.13',
    } as never);

    await expect(
      instance.decide!({
        model: 'typesafe/jev-1.13',
        questions: {
          pick: {
            criteria: { other: 'Anything else.', toString: 'A method-named option.' },
            instructions: 'Pick one.',
            type: 'choice',
          },
        },
        state: 'x',
      }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
  });

  it('rejects a request without questions before calling the provider', async () => {
    const instance = createInstance();
    const post = vi.spyOn(instance['client'], 'post');

    await expect(
      instance.decide!({ model: 'typesafe/jev-1.13', questions: {}, state: 'x' }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InvalidRequestFormat });
    expect(post).not.toHaveBeenCalled();
  });
});
