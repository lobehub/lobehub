import { evalCaseVersionOf } from '@lobechat/types';

import { isRetiredEvalTestCase } from '@/database/models/agentEval/testCase';

import type { EvalRunDeps } from './types';

export class EvalCaseCompatibilityError extends Error {
  constructor(message: string) {
    super(`${message}. Create a new experiment with the current dataset instead.`);
    this.name = 'EvalCaseCompatibilityError';
  }
}

interface CaseTarget {
  testCase?: { metadata?: Record<string, unknown> | null } | null;
  testCaseId: string;
}

/**
 * Prevent known incompatible retries from rewriting historical evidence. This
 * compares the recorded Release/presentation, not a complete environment snapshot.
 */
export const assertRunCaseCompatibility = async (
  deps: Pick<EvalRunDeps, 'datasetModel'>,
  run: { config?: { caseVersion?: string } | null; datasetId: string },
  targets: CaseTarget[] = [],
) => {
  const dataset = await deps.datasetModel.findById(run.datasetId);
  if (!dataset) throw new EvalCaseCompatibilityError('The run dataset is no longer available');

  if (run.config?.caseVersion !== evalCaseVersionOf(dataset.metadata)) {
    throw new EvalCaseCompatibilityError('The dataset case version has changed since this run');
  }

  if (targets.some((target) => !target.testCase || isRetiredEvalTestCase(target.testCase))) {
    throw new EvalCaseCompatibilityError('The requested cases include a retired or missing case');
  }
};
