// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { LobeNaceAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

/** Shape of a `POST /v1/systemone` reply from Drex, including the `legend` array of score levels. */
const drexReply = {
  answers: {
    done: { noul: 0.0017, type: 'noul' },
    grade: {
      confidence: 0.705,
      legend: ['unclear', 'partly clear', 'clear'],
      probabilities: { '0': 0.133, '1': 0.803, '2': 0.063 },
      score: 0.93,
      type: 'score',
    },
    next: {
      choice: 'E1',
      confidence: 0.9987,
      probabilities: { E1: 0.9991, E2: 0.0007 },
      type: 'choice',
    },
  },
  evaluation_time_ms: 180.8,
  model: 'drex-max',
  request_id: 'req_test',
  usage: { input_tokens: 307, output_tokens: 311 },
};

describe('LobeNaceAI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the System One endpoint with Drex Max and maps the Drex reply', async () => {
    const runtime = new LobeNaceAI({ apiKey: 'test-key' });
    const post = vi
      .spyOn(runtime['runtime']['client'], 'post')
      .mockResolvedValue(drexReply as never);

    const result = await runtime.decide!(
      {
        model: 'drex-max',
        questions: {
          done: { instructions: 'Is the task complete?', type: 'boolean' },
          grade: {
            criteria: ['unclear', 'partly clear', 'clear'],
            instructions: 'How clear is the current screen?',
            type: 'score',
          },
          next: {
            criteria: { E1: 'Click the Save button', E2: null },
            instructions: 'Which element should the agent click next?',
            type: 'choice',
          },
        },
        state: 'The form is filled in and the Save button is enabled.',
      },
      { user: 'internal-probe' },
    );

    expect(runtime.baseURL).toBe('https://console.nace.ai/v1');
    expect(post).toHaveBeenCalledWith(
      '/systemone',
      expect.objectContaining({
        body: {
          model: 'drex-max',
          questions: {
            done: { instructions: 'Is the task complete?', type: 'noul' },
            grade: {
              criteria: ['unclear', 'partly clear', 'clear'],
              instructions: 'How clear is the current screen?',
              type: 'score',
            },
            next: {
              criteria: { E1: 'Click the Save button', E2: null },
              instructions: 'Which element should the agent click next?',
              type: 'choice',
            },
          },
          state: 'The form is filled in and the Save button is enabled.',
        },
        maxRetries: 0,
      }),
    );
    expect(result).toMatchObject({
      answers: {
        done: { probability: 0.0017, type: 'boolean' },
        grade: {
          confidence: 0.705,
          probabilities: [0.133, 0.803, 0.063],
          score: 0.93,
          type: 'score',
        },
        next: {
          choice: 'E1',
          confidence: 0.9987,
          probabilities: { E1: 0.9991, E2: 0.0007 },
          type: 'choice',
        },
      },
      model: 'drex-max',
      usage: {
        inputTextTokens: 307,
        outputTextTokens: 311,
        totalTokens: 618,
      },
    });
  });

  it('serializes structured instructions and criteria, which Drex only accepts as strings', async () => {
    const runtime = new LobeNaceAI({ apiKey: 'test-key' });
    const post = vi.spyOn(runtime['runtime']['client'], 'post').mockResolvedValue({
      answers: {
        approve: { noul: 0.2, type: 'noul' },
        route: { choice: 'billing', probabilities: { billing: 0.9, other: 0.1 }, type: 'choice' },
        urgency: { probabilities: { '0': 0.7, '1': 0.3 }, score: 0.3, type: 'score' },
      },
      model: 'drex-v2.0',
      usage: { input_tokens: 120, output_tokens: 9 },
    } as never);

    await runtime.decide!({
      model: 'drex-v2.0',
      questions: {
        approve: {
          criteria: { false: ['anything else'], true: { reason: 'duplicate charge' } },
          instructions: { ask: 'Should this refund be approved?' },
          type: 'boolean',
        },
        route: {
          criteria: { billing: { topics: ['invoices', 'refunds'] }, other: null },
          instructions: 'Which team handles this ticket?',
          type: 'choice',
        },
        urgency: {
          criteria: [{ level: 'low' }, 'high'],
          instructions: ['How urgent is it?'],
          type: 'score',
        },
      },
      state: { amount: 125, reason: 'duplicate charge' },
    });

    expect(post).toHaveBeenCalledWith(
      '/systemone',
      expect.objectContaining({
        body: {
          model: 'drex-v2.0',
          questions: {
            approve: {
              criteria: { false: '["anything else"]', true: '{"reason":"duplicate charge"}' },
              instructions: '{"ask":"Should this refund be approved?"}',
              type: 'noul',
            },
            route: {
              criteria: { billing: '{"topics":["invoices","refunds"]}', other: null },
              instructions: 'Which team handles this ticket?',
              type: 'choice',
            },
            urgency: {
              criteria: ['{"level":"low"}', 'high'],
              instructions: '["How urgent is it?"]',
              type: 'score',
            },
          },
          state: { amount: 125, reason: 'duplicate charge' },
        },
      }),
    );
  });

  it('does not expose unsupported OpenAI-compatible capabilities', () => {
    const runtime: LobeRuntimeAI = new LobeNaceAI({ apiKey: 'test-key' });

    expect(runtime.chat).toBeUndefined();
    expect(runtime.embeddings).toBeUndefined();
    expect(runtime.generateObject).toBeUndefined();
    expect(runtime.models).toBeUndefined();
  });
});
