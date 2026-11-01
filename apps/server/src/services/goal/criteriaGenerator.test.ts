import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalCriteriaGeneratorService } from './criteriaGenerator';

const { generateObject, resolveGoalModelConfig } = vi.hoisted(() => ({
  generateObject: vi.fn(),
  resolveGoalModelConfig: vi.fn(),
}));

vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: vi.fn(function () {
    return { generateObject };
  }),
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

  it('traces executable decomposition with its updated prompt cohort and validates the output', async () => {
    const service = new GoalCriteriaGeneratorService({} as never, 'user-1');
    const draft = {
      problemStatement: 'Deliver editable office documents.',
      tasks: [
        { dependsOn: [], instruction: 'Document current gaps.', title: 'Investigate' },
        { dependsOn: [0], instruction: 'Implement editing and persistence.', title: 'Implement' },
      ],
    };
    generateObject.mockResolvedValueOnce(draft);
    // An answer without the understanding fields still plans, as a clear goal.
    await expect(service.decompose({ requirement: 'Upgrade office editing' })).resolves.toEqual({
      ...draft,
      assumptions: [],
      questions: [],
    });
    expect(generateObject).toHaveBeenLastCalledWith(
      expect.objectContaining({ schema: expect.objectContaining({ name: 'goal_decomposition' }) }),
      expect.objectContaining({
        tracing: {
          promptVersion: 'v9',
          scenario: 'goal_decompose',
          schemaName: 'goal_decomposition',
        },
      }),
    );
    generateObject.mockResolvedValueOnce({ ...draft, tasks: [{ title: 'Missing instruction' }] });
    await expect(service.decompose({ requirement: 'Upgrade office editing' })).rejects.toThrow(
      'did not match the decomposition schema: tasks.0.instruction',
    );
  });

  it('drops evidence values outside the supported enums but keeps the criterion', async () => {
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
    ).resolves.toEqual([
      {
        description: 'The release is visible',
        instruction: 'Inspect the release.',
        onFail: 'auto_repair',
        required: true,
        requiredEvidence: [],
        title: 'Release shipped',
        verifierType: 'agent',
      },
    ]);
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('maps modality-style evidence types from an image goal instead of failing the draft', async () => {
    // Shape the real goal model returned for a goal whose content is only an image.
    generateObject.mockResolvedValue({
      criteria: [
        {
          requiredEvidence: [
            { hint: 'Design mockup', modality: 'image', scope: 'task_artifacts', type: 'image' },
            { hint: 'Spec notes', scope: 'deliverable', type: 'document' },
            { hint: 'Page DOM', modality: 'structured', type: 'dom_snapshot' },
          ],
          title: 'Page matches the mockup',
          verifierType: 'agent',
        },
      ],
      instruction: 'Build the landing page shown in the mockup.',
      title: 'Landing page from mockup',
    });

    await expect(
      new GoalCriteriaGeneratorService({} as any, 'user-1').generatePlan({
        goal: '![aquafit-landing-mockup.png](https://example.com/mockup.png)',
      }),
    ).resolves.toEqual({
      criteria: [
        {
          requiredEvidence: [
            {
              hint: 'Design mockup',
              modality: 'image',
              scope: 'task_artifacts',
              type: 'screenshot',
            },
            { hint: 'Spec notes', modality: 'document', scope: 'deliverable', type: 'markdown' },
            { hint: 'Page DOM', modality: 'structured', type: 'dom_snapshot' },
          ],
          title: 'Page matches the mockup',
          verifierType: 'agent',
        },
      ],
      instruction: 'Build the landing page shown in the mockup.',
      title: 'Landing page from mockup',
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
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

  it('asks again when the model returns an empty structured output', async () => {
    const plan = {
      criteria: [{ title: 'Brief is delivered', verifierType: 'agent' }],
      instruction: 'Write the daily AI news brief, following the attached layout.',
      title: 'Daily AI news brief',
    };
    generateObject.mockResolvedValueOnce({}).mockResolvedValueOnce(plan);

    await expect(
      new GoalCriteriaGeneratorService({} as any, 'user-1').generatePlan({
        goal: 'Write the daily AI news brief\n\n![image.png](https://example.com/layout.png)',
      }),
    ).resolves.toEqual(plan);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of empty structured outputs', async () => {
    generateObject.mockResolvedValue({});

    await expect(
      new GoalCriteriaGeneratorService({} as any, 'user-1').generatePlan({ goal: 'Ship it' }),
    ).resolves.toBeUndefined();
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("plans a goal's decomposition on the goal's own planning model", async () => {
    const goalConfig = { model: 'gemini-3.8-flash', provider: 'google' };
    generateObject.mockResolvedValueOnce({ problemStatement: 'p', tasks: [] });

    await new GoalCriteriaGeneratorService({} as never, 'user-1')
      .decompose({ goalConfig, requirement: 'Upgrade office editing' })
      .catch(() => undefined);

    expect(resolveGoalModelConfig).toHaveBeenCalledWith({}, 'user-1', goalConfig);
  });
});
