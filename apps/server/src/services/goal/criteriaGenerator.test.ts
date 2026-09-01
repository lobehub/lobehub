import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalCriteriaGeneratorService } from './criteriaGenerator';

const { generateObject, resolveGoalModelConfig } = vi.hoisted(() => ({
  generateObject: vi.fn(),
  resolveGoalModelConfig: vi.fn(),
}));

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(() => ({ generateObject })),
}));

vi.mock('./modelConfig', () => ({ resolveGoalModelConfig }));

describe('GoalCriteriaGeneratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGoalModelConfig.mockResolvedValue({ model: 'goal-model', provider: 'goal-provider' });
    generateObject.mockResolvedValue({
      criteria: [],
      instruction: 'Publish the benchmark paper.',
      title: 'Publish benchmark paper',
    });
  });

  it('uses the dedicated goal model, prompt version, schema, and tracing scenario', async () => {
    await new GoalCriteriaGeneratorService({} as any, 'user-1', 'workspace-1').generate({
      goal: 'Publish a benchmark paper',
    });

    expect(resolveGoalModelConfig).toHaveBeenCalledWith({}, 'user-1');
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'goal-model',
        provider: 'goal-provider',
        schema: expect.objectContaining({ name: 'goal_criteria_draft' }),
      }),
      expect.objectContaining({
        tracing: {
          promptVersion: 'v3',
          scenario: 'goal_criteria_gen',
          schemaName: 'goal_criteria_draft',
        },
      }),
    );
  });

  it('rejects criteria containing evidence values outside the supported enums', async () => {
    generateObject.mockResolvedValue({
      criteria: [
        {
          description: 'The release is visible',
          instruction: 'Inspect the release.',
          onFail: 'auto_repair',
          required: true,
          requiredEvidence: [
            { hint: 'Capture it', modality: 'hologram', scope: 'somewhere', type: 'binary' },
          ],
          title: 'Release shipped',
          verifierType: 'agent',
        },
      ],
      instruction: 'Ship it.',
      title: 'Ship it',
    });

    await expect(
      new GoalCriteriaGeneratorService({} as any, 'user-1').generate({ goal: 'Ship it' }),
    ).resolves.toEqual([]);
  });

  it('keeps the array response for existing callers while exposing the full generated plan', async () => {
    generateObject.mockResolvedValue({
      criteria: [{ title: 'Benchmark is published', verifierType: 'agent' }],
      instruction: 'Publish the benchmark paper.',
      title: 'Publish benchmark paper',
    });
    const service = new GoalCriteriaGeneratorService({} as any, 'user-1');

    await expect(service.generate({ goal: 'Publish a benchmark paper' })).resolves.toEqual([
      { title: 'Benchmark is published', verifierType: 'agent' },
    ]);
    await expect(service.generatePlan({ goal: 'Publish a benchmark paper' })).resolves.toEqual({
      criteria: [{ title: 'Benchmark is published', verifierType: 'agent' }],
      instruction: 'Publish the benchmark paper.',
      title: 'Publish benchmark paper',
    });
  });
});
