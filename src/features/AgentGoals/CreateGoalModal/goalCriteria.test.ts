import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import { createFallbackGoalCriterion, generateGoalCriteria } from './goalCriteria';

describe('generateGoalCriteria', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and normalizes acceptance criteria for the goal review step', async () => {
    const generateCriteria = vi
      .spyOn(verifyService, 'generateCriteria')
      .mockResolvedValue([
        { title: 'Paper draft is complete' },
        { required: false, title: 'Results are reproducible', verifierType: 'llm' },
      ]);

    const result = await generateGoalCriteria({
      context: 'Goal: Publish an ICLR paper',
      goal: 'Complete an RSI benchmark paper in three months',
      model: 'test-model',
      provider: 'test-provider',
    });

    expect(generateCriteria).toHaveBeenCalledWith({
      context: 'Goal: Publish an ICLR paper',
      goal: 'Complete an RSI benchmark paper in three months',
      maxCriteria: 8,
      modelConfig: { model: 'test-model', provider: 'test-provider' },
    });
    expect(result).toEqual([
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
    ]);
  });

  it('rejects an empty AI response instead of advancing with no criteria', async () => {
    vi.spyOn(verifyService, 'generateCriteria').mockResolvedValue([]);

    await expect(
      generateGoalCriteria({
        goal: 'Ship the project',
        model: 'test-model',
        provider: 'test-provider',
      }),
    ).rejects.toThrow('No acceptance criteria were generated.');
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
