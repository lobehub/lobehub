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
    generateObject.mockResolvedValue({ criteria: [] });
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
          promptVersion: 'v1',
          scenario: 'goal_criteria_gen',
          schemaName: 'goal_criteria_draft',
        },
      }),
    );
  });
});
