import type { VerifyCheckItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VerifyPlanGeneratorService } from '../planGenerator';

// Mock the model modules the generator constructs (holistic fallback).
const { setPlanMock, ensureForOperationMock, getCriteriaMock, findByIdsMock } = vi.hoisted(() => ({
  ensureForOperationMock: vi.fn(async () => ({ id: 'run-1' })),
  findByIdsMock: vi.fn(async () => [] as any[]),
  getCriteriaMock: vi.fn(async () => [] as any[]),
  setPlanMock: vi.fn(async (_runId: string, _items: any[]) => {}),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({
    ensureForOperation: ensureForOperationMock,
    setPlan: setPlanMock,
  })),
}));
vi.mock('@/database/models/verifyRubric', () => ({
  VerifyRubricModel: vi.fn(() => ({ getCriteria: getCriteriaMock })),
}));
vi.mock('@/database/models/verifyCriterion', () => ({
  VerifyCriterionModel: vi.fn(() => ({ findByIds: findByIdsMock })),
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
    expect(plan[0].title).toBe('Crit 1');
    expect(plan[0].verifierType).toBe('llm');
  });
});
