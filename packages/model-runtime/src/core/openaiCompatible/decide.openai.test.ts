// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenAI } from '../../providers/openai';
import type { DecisionPayload } from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';

// Price from the real OpenAI cards so the test also covers the `:decision` card's pricing.
vi.mock('@lobechat/business-model-bank/model-config', async () => {
  const { default: openaiModels } = await import('model-bank/openai');
  return {
    loadModels: async () => openaiModels.map((model) => ({ ...model, providerId: 'openai' })),
  };
});

const createInstance = () => new LobeOpenAI({ apiKey: 'test-key' });

const payload = {
  model: 'gpt-6-luna:decision',
  questions: {
    intent: {
      criteria: { billing: 'Payment problems.', other: null },
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

const openaiResponse = {
  answers: [
    {
      choice: 'billing',
      confidence: 0.93,
      name: 'intent',
      probabilities: [
        { probability: 0.97, value: 'billing' },
        { probability: 0.03, value: 'other' },
      ],
      type: 'choice',
    },
    { name: 'refund', probability: 0.99, type: 'predicate' },
    {
      confidence: 0.5,
      name: 'urgency',
      probabilities: [
        { label: '0', probability: 0.05, value: 0 },
        { label: '1', probability: 0.25, value: 1 },
        { label: '2', probability: 0.7, value: 2 },
      ],
      score: 1.65,
      type: 'score',
    },
  ],
  model: 'gpt-6-luna-2026-10-06',
  usage: {
    input_tokens: 436,
    input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
    output_tokens: 3,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 439,
  },
};

describe('decide via the OpenAI Decisions API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips the :decision suffix and sends OpenAI questions without SDK retries', async () => {
    const instance = createInstance();
    const post = vi.spyOn(instance['client'], 'post').mockResolvedValue(openaiResponse as never);

    await instance.decide!(payload, { user: 'user-1' });

    expect(post).toHaveBeenCalledWith(
      '/decisions',
      expect.objectContaining({
        body: {
          input: payload.state,
          model: 'gpt-6-luna',
          questions: [
            {
              choices: [{ description: 'Payment problems.', value: 'billing' }, { value: 'other' }],
              instructions: 'What is the ticket about?',
              name: 'intent',
              type: 'choice',
            },
            {
              instructions:
                'Is the customer asking for a refund?\n\nTrue when: Asks for money back.\n\nFalse when: No refund requested.',
              name: 'refund',
              type: 'predicate',
            },
            {
              instructions: 'How urgent is the ticket?',
              levels: [
                { description: 'Low', label: '0' },
                { description: 'Medium', label: '1' },
                { description: 'High', label: '2' },
              ],
              name: 'urgency',
              type: 'score',
            },
          ],
          safety_identifier: 'user-1',
        },
        maxRetries: 0,
      }),
    );
  });

  it('maps the answers array back to answers keyed by question name', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue(openaiResponse as never);

    const result = await instance.decide!(payload);

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
      model: 'gpt-6-luna-2026-10-06',
      usage: expect.objectContaining({ totalTokens: 439 }),
    });
  });

  it('prices usage from the :decision card on input tokens only', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue(openaiResponse as never);
    const onUsage = vi.fn();
    const onProviderReportedCost = vi.fn();

    const { usage } = await instance.decide!(payload, { onProviderReportedCost, onUsage });

    expect(onUsage).toHaveBeenCalledWith(usage);
    expect(usage).toMatchObject({ inputTextTokens: 436, outputTextTokens: 3, totalTokens: 439 });
    // 436 input tokens × $0.10/M = 43.6 credits, ceiled to whole credits; output tokens are free.
    expect(usage?.cost).toBe(0.000_044);
    // OpenAI reports no charge of its own.
    expect(onProviderReportedCost).not.toHaveBeenCalled();
  });

  it('serializes structured state, instructions and criteria to the strings OpenAI accepts', async () => {
    const instance = createInstance();
    const post = vi.spyOn(instance['client'], 'post').mockResolvedValue({
      answers: [{ name: 'refund', probability: 0.8, type: 'predicate' }],
      model: 'gpt-6-luna',
    } as never);

    const result = await instance.decide!({
      model: 'gpt-6-luna:decision',
      questions: {
        refund: { instructions: { ask: 'Is this a refund request?' }, type: 'boolean' },
      },
      state: { ticket: { body: 'Money back please' } },
    });

    expect(post.mock.calls[0][1]).toMatchObject({
      body: {
        input: '{"ticket":{"body":"Money back please"}}',
        questions: [
          {
            instructions: '{"ask":"Is this a refund request?"}',
            name: 'refund',
            type: 'predicate',
          },
        ],
      },
    });
    expect(result.answers.refund).toEqual({ probability: 0.8, type: 'boolean' });
    expect(result.usage).toBeUndefined();
  });

  it('returns a refusal as an answer, including one without a name', async () => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...openaiResponse,
      answers: [{ name: null, type: 'refusal' }, ...openaiResponse.answers.slice(1)],
    } as never);

    const result = await instance.decide!(payload);

    expect(result.answers.intent).toEqual({ type: 'refusal' });
    expect(result.answers.refund).toEqual({ probability: 0.99, type: 'boolean' });
  });

  it('omits probabilities when the provider does not report a distribution', async () => {
    const instance = createInstance();
    const [intent, refund, urgency] = openaiResponse.answers;
    const { probabilities: _, ...intentWithout } = intent as typeof intent & {
      probabilities: unknown;
    };
    const { probabilities: __, ...urgencyWithout } = urgency as typeof urgency & {
      probabilities: unknown;
    };
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...openaiResponse,
      answers: [intentWithout, refund, urgencyWithout],
    } as never);

    const result = await instance.decide!(payload);

    expect(result.answers.intent).toEqual({ choice: 'billing', confidence: 0.93, type: 'choice' });
    expect(result.answers.urgency).toEqual({ confidence: 0.5, score: 1.65, type: 'score' });
  });

  const [intentAnswer, refundAnswer, urgencyAnswer] = openaiResponse.answers;

  it.each([
    [
      'a choice outside the requested options',
      [{ ...intentAnswer, choice: 'shipping' }, refundAnswer, urgencyAnswer],
    ],
    ['a boolean choice value', [{ ...intentAnswer, choice: true }, refundAnswer, urgencyAnswer]],
    [
      'a choice without a probability for every option',
      [
        { ...intentAnswer, probabilities: [{ probability: 1, value: 'billing' }] },
        refundAnswer,
        urgencyAnswer,
      ],
    ],
    [
      'a score without a probability for every level',
      [
        intentAnswer,
        refundAnswer,
        {
          ...urgencyAnswer,
          probabilities: [
            { probability: 0.3, value: 0 },
            { probability: 0.7, value: 1 },
          ],
        },
      ],
    ],
    ['an answer of the wrong type', [intentAnswer, intentAnswer, urgencyAnswer]],
    ['a missing answer', [intentAnswer, refundAnswer]],
    ['answers in a different order', [refundAnswer, intentAnswer, urgencyAnswer]],
  ])('rejects %s as a provider error', async (_, answers) => {
    const instance = createInstance();
    vi.spyOn(instance['client'], 'post').mockResolvedValue({
      ...openaiResponse,
      answers,
    } as never);
    const onUsage = vi.fn();

    await expect(instance.decide!(payload, { onUsage })).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: 'openai',
    });
    expect(onUsage).not.toHaveBeenCalled();
  });
});
