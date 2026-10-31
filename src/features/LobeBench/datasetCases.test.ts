import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDataset } from '@/features/LobeBench/datasetCases';
import type { LobeBenchCase } from '@/features/LobeBench/useLobeBench';
import { mutate } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));
vi.mock('@/store/eval', () => ({ useEvalStore: vi.fn() }));
vi.mock('@/services/agentEval', () => ({
  agentEvalService: {
    batchCreateTestCases: vi.fn(),
    createDataset: vi.fn(),
    deleteDataset: vi.fn(),
    updateDataset: vi.fn(),
  },
}));

const cases: LobeBenchCase[] = [
  {
    content: { input: 'Complete the task', environment: { mergedSharedValue: true } },
    environment: { id: 'shared-env', name: 'Shared environment' },
    environmentId: 'shared-env',
    environmentOverrides: { currentDate: '2026-01-01' },
    evalConfig: { criteria: ['A rule'], model: 'case-judge' },
    evalMode: 'rule-checklist',
    id: 'case-a',
    metadata: { caseId: 'native-a', title: 'A case' },
    sortOrder: 4,
  },
];
const library = {
  evalConfig: { model: 'library-judge' },
  evalMode: 'rule-checklist',
  metadata: { mock: { endpoint: '/mock' }, presentation: 'v2', release: 'release-v1' },
};

beforeEach(() => vi.clearAllMocks());

describe('atomic dataset creation request', () => {
  it.each([{ id: 'new-set' }, { data: { id: 'new-set' } }])(
    'submits the dataset and copied cases once with response %j',
    async (response) => {
      vi.mocked(agentEvalService.createDataset).mockResolvedValue(response as never);
      expect(await createDataset('bench', 'My dataset', library, cases)).toEqual({ id: 'new-set' });
      expect(agentEvalService.createDataset).toHaveBeenCalledTimes(1);
      expect(agentEvalService.createDataset).toHaveBeenCalledWith(
        expect.objectContaining({
          benchmarkId: 'bench',
          name: 'My dataset',
          evalConfig: library.evalConfig,
          evalMode: library.evalMode,
          metadata: expect.objectContaining(library.metadata),
          cases: [
            {
              content: { input: 'Complete the task', environment: { currentDate: '2026-01-01' } },
              environmentId: 'shared-env',
              evalConfig: cases[0].evalConfig,
              evalMode: cases[0].evalMode,
              metadata: { ...cases[0].metadata, source: 'library' },
              sortOrder: 4,
            },
          ],
        }),
      );
      expect(agentEvalService.batchCreateTestCases).not.toHaveBeenCalled();
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(cases[0].content?.environment).toEqual({ mergedSharedValue: true });
    },
  );

  it('propagates transaction failure without a second mutation or a success refresh', async () => {
    const failure = new Error('Case validation rejected the transaction');
    vi.mocked(agentEvalService.createDataset).mockRejectedValue(failure);
    await expect(createDataset('bench', 'My dataset', library, cases)).rejects.toBe(failure);
    expect(agentEvalService.createDataset).toHaveBeenCalledTimes(1);
    expect(agentEvalService.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ cases: expect.any(Array) }),
    );
    expect(agentEvalService.batchCreateTestCases).not.toHaveBeenCalled();
    expect(agentEvalService.deleteDataset).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
