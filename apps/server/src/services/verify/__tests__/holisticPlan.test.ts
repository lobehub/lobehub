import { LobeDeliveryCheckerManifest } from '@lobechat/builtin-tool-lobe-delivery-checker';
import type { VerifyCheckItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyPlanGeneratorService } from '../planGenerator';

// Mock the model modules the generator constructs (holistic fallback).
const {
  confirmPlanMock,
  createCriterionMock,
  createRubricMock,
  ensureForOperationMock,
  findByIdsMock,
  getCriteriaMock,
  setCriteriaMock,
  setPlanMock,
} = vi.hoisted(() => ({
  confirmPlanMock: vi.fn(),
  createCriterionMock: vi.fn(async (input: any) => ({ id: 'created-criterion', ...input })),
  createRubricMock: vi.fn(async () => ({ id: 'rub-created' })),
  ensureForOperationMock: vi.fn(async () => ({ id: 'run-1' })),
  findByIdsMock: vi.fn(async () => [] as any[]),
  getCriteriaMock: vi.fn(async () => [] as any[]),
  setCriteriaMock: vi.fn(),
  setPlanMock: vi.fn(async (_runId: string, _items: any[]) => {}),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    ensureForOperation: ensureForOperationMock,
    confirmPlan: confirmPlanMock,
    setPlan: setPlanMock,
  })),
}));
vi.mock('@/database/models/verifyRubric', () => ({
  VerifyRubricModel: vi.fn(() => ({
    create: createRubricMock,
    getCriteria: getCriteriaMock,
    setCriteria: setCriteriaMock,
  })),
}));
vi.mock('@/database/models/verifyCriterion', () => ({
  VerifyCriterionModel: vi.fn(() => ({
    create: createCriterionMock,
    findByIds: findByIdsMock,
  })),
}));
vi.mock('@/database/models/document', () => ({ DocumentModel: vi.fn(() => ({})) }));
vi.mock('@/server/services/aiGeneration', () => ({ AiGenerationService: vi.fn(() => ({})) }));

const db = {} as any;
const lastPlan = (): VerifyCheckItem[] => setPlanMock.mock.calls.at(-1)![1] as VerifyCheckItem[];

describe('generateDraftPlan — holistic fallback', () => {
  beforeEach(() => {
    setPlanMock.mockClear();
    getCriteriaMock.mockResolvedValue([]);
    findByIdsMock.mockResolvedValue([]);
  });

  it('synthesizes one agent-type holistic check from the requirement when no criteria', async () => {
    const svc = new VerifyPlanGeneratorService(db, 'user-1');
    await svc.generateDraftPlan({
      goal: 'do the thing',
      holisticFallback: true,
      operationId: 'op-1',
      requirement: 'The UI shows the new badge',
    });

    const plan = lastPlan();
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      description: 'The UI shows the new badge',
      onFail: 'manual',
      required: true,
      verifierType: 'agent',
    });
  });

  it('falls back to the goal when no requirement', async () => {
    const svc = new VerifyPlanGeneratorService(db, 'user-1');
    await svc.generateDraftPlan({
      goal: 'fix the bug',
      holisticFallback: true,
      operationId: 'op-1',
    });
    expect(lastPlan()[0].description).toBe('fix the bug');
  });

  it('does NOT synthesize when holisticFallback is off — empty plan stays empty', async () => {
    const svc = new VerifyPlanGeneratorService(db, 'user-1');
    await svc.generateDraftPlan({ goal: 'x', holisticFallback: false, operationId: 'op-1' });
    expect(lastPlan()).toHaveLength(0);
  });

  it('does NOT add a holistic item when criteria already produced items', async () => {
    getCriteriaMock.mockResolvedValue([
      {
        description: null,
        documentId: null,
        id: 'c1',
        onFail: 'manual',
        required: true,
        title: 'Crit 1',
        verifierConfig: {},
        verifierType: 'llm',
      },
    ]);
    const svc = new VerifyPlanGeneratorService(db, 'user-1');
    await svc.generateDraftPlan({
      goal: 'x',
      holisticFallback: true,
      operationId: 'op-1',
      verifyRubricId: 'rub-1',
    });

    const plan = lastPlan();
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe('c1');
    expect(plan[0].title).toBe('Crit 1');
    expect(plan[0].verifierType).toBe('llm');
  });

  it('preserves verifierConfig from mounted criteria in the frozen plan', async () => {
    getCriteriaMock.mockResolvedValue([
      {
        id: 'c-evidence',
        onFail: 'auto_repair',
        required: true,
        title: 'Visual proof',
        verifierConfig: {
          requiredEvidence: [{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }],
        },
        verifierType: 'llm',
      },
    ]);

    await new VerifyPlanGeneratorService(db, 'user-1').generateDraftPlan({
      goal: 'x',
      operationId: 'op-1',
      verifyRubricId: 'rub-1',
    });

    expect(lastPlan()[0].verifierConfig).toEqual({
      requiredEvidence: [{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }],
    });
  });

  it('persists agent-authored verifierConfig instead of replacing it with an empty object', async () => {
    const config = {
      requiredEvidence: [{ modality: 'image', scope: 'run_evidence', type: 'screenshot' }],
    };
    const result = await new VerifyPlanGeneratorService(db, 'user-1').createPlanFromCriteria({
      criteria: [{ title: 'Visual proof', verifierConfig: config, verifierType: 'llm' }],
      operationId: 'op-1',
      title: 'Acceptance',
    });

    expect(createCriterionMock).toHaveBeenCalledWith(
      expect.objectContaining({ verifierConfig: config }),
    );
    expect(result.items[0].verifierConfig).toEqual(config);
  });

  it('exposes the required evidence inventory in the agent tool contract', () => {
    const criterion = LobeDeliveryCheckerManifest.api[0].parameters.properties.criteria.items;

    expect(criterion.required).toContain('requiredEvidence');
    expect(criterion.properties.requiredEvidence.items.required).toEqual([
      'type',
      'modality',
      'scope',
      'hint',
    ]);
  });
});
