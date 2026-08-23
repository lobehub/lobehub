import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import { createFallbackGoalCriterion, generateGoalCriteria } from './goalCriteria';

describe('generateGoalCriteria', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and normalizes acceptance criteria for the goal review step', async () => {
    const generateCriteria = vi.spyOn(verifyService, 'generateGoalPlan').mockResolvedValue({
      criteria: [
        { title: 'Paper draft is complete' },
        { required: false, title: 'Results are reproducible', verifierType: 'llm' },
      ],
      instruction:
        'Complete an RSI benchmark paper in three months. Write and publish the benchmark paper.',
      title: 'Publish benchmark paper',
    });

    const result = await generateGoalCriteria({
      context: 'Goal: Publish an ICLR paper',
      goal: 'Complete an RSI benchmark paper in three months',
    });

    expect(generateCriteria).toHaveBeenCalledWith({
      context: 'Goal: Publish an ICLR paper',
      goal: 'Complete an RSI benchmark paper in three months',
      maxCriteria: 8,
    });
    expect(result).toEqual({
      criteria: [
        {
          onFail: 'auto_repair',
          required: true,
          title: 'Paper draft is complete',
          verifierType: 'agent',
        },
        {
          onFail: 'auto_repair',
          required: false,
          title: 'Results are reproducible',
          verifierType: 'llm',
        },
      ],
      instruction:
        'Complete an RSI benchmark paper in three months. Write and publish the benchmark paper.',
      title: 'Publish benchmark paper',
    });
  });

  it('rejects an empty AI response instead of advancing with no criteria', async () => {
    vi.spyOn(verifyService, 'generateGoalPlan').mockResolvedValue({
      criteria: [],
      instruction: 'Ship the project.',
      title: 'Ship the project',
    });

    await expect(
      generateGoalCriteria({
        goal: 'Ship the project',
      }),
    ).rejects.toThrow('No goal plan was generated.');
  });

  it('keeps the exact user goal when the generated instruction omits it', async () => {
    vi.spyOn(verifyService, 'generateGoalPlan').mockResolvedValue({
      criteria: [{ title: 'Training loop works' }],
      instruction: 'Implement a reproducible self-improvement training loop.',
      title: 'Reproduce self-improvement training',
    });
    const goal =
      'Reproduce https://ornith.ai/ornith_1_5.html with a three-round budget and export results.';

    const result = await generateGoalCriteria({ goal });

    expect(result.instruction).toBe(
      `${goal}\n\nImplement a reproducible self-improvement training loop.`,
    );
  });

  it('uses the original goal as a reviewable criterion when AI generation fails', () => {
    expect(createFallbackGoalCriterion('Ship the project')).toEqual({
      onFail: 'auto_repair',
      required: true,
      title: 'Ship the project',
      verifierType: 'agent',
    });
  });
});
