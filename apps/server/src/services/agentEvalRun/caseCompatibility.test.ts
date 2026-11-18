import { describe, expect, it, vi } from 'vitest';

import { assertRunCaseCompatibility, EvalCaseCompatibilityError } from './caseCompatibility';
import type { EvalRunDeps } from './types';

const depsFor = (metadata?: Record<string, unknown>) =>
  ({
    datasetModel: { findById: vi.fn().mockResolvedValue({ metadata }) },
  }) as unknown as Pick<EvalRunDeps, 'datasetModel'>;

describe('assertRunCaseCompatibility', () => {
  it('allows unversioned Eval Lab runs and matching Release/presentation versions', async () => {
    await expect(
      assertRunCaseCompatibility(depsFor(), { datasetId: 'lab' }),
    ).resolves.toBeUndefined();
    await expect(
      assertRunCaseCompatibility(
        depsFor({ release: 'v1', presentation: 'realism-v1' }),
        { config: { caseVersion: 'v1+realism-v1' }, datasetId: 'bench' },
        [{ testCase: { metadata: {} }, testCaseId: 'case' }],
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['v1', { release: 'v2' }],
    ['v1+realism-v1', { release: 'v1', presentation: 'realism-v2' }],
    [undefined, { release: 'v1' }],
    ['v1', undefined],
  ] as const)(
    'rejects incompatible stored version %s and current metadata %o',
    async (caseVersion, metadata) => {
      await expect(
        assertRunCaseCompatibility(depsFor(metadata), {
          config: { caseVersion },
          datasetId: 'bench',
        }),
      ).rejects.toThrow(EvalCaseCompatibilityError);
    },
  );

  it('rejects retired or unavailable targets even when versions match', async () => {
    for (const testCase of [null, { metadata: { retired: true } }]) {
      await expect(
        assertRunCaseCompatibility(
          depsFor({ release: 'v1' }),
          { config: { caseVersion: 'v1' }, datasetId: 'bench' },
          [{ testCase, testCaseId: 'old-case' }],
        ),
      ).rejects.toThrow('retired or missing case');
    }
  });
});
