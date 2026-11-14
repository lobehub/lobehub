import type { EvalCaseSelection } from '@lobechat/types';

interface SelectableCase {
  id: string;
  metadata?: { caseId?: unknown } | null;
}

/** The id a case is selected by: its dataset-native `metadata.caseId`, else its primary key. */
export const nativeCaseId = (testCase: SelectableCase) =>
  typeof testCase.metadata?.caseId === 'string' && testCase.metadata.caseId
    ? testCase.metadata.caseId
    : testCase.id;

export const CASE_SELECTION_UNKNOWN_IDS = 'Case selection names cases that are not in the dataset';

/**
 * The cases a run executes: the whole dataset, or the part its
 * `config.caseSelection` keeps. A selection that names an unknown case is an
 * error rather than a silent skip, so a run never waits for a case that does
 * not exist.
 */
export const selectCases = <T extends SelectableCase>(
  testCases: T[],
  selection: EvalCaseSelection | null | undefined,
): T[] => {
  if (!selection || selection.mode === 'all') return testCases;
  const ids = new Set(selection.caseIds ?? []);
  const known = new Set(testCases.map(nativeCaseId));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`${CASE_SELECTION_UNKNOWN_IDS}: ${id}`);
  }
  return testCases.filter((testCase) =>
    selection.mode === 'include'
      ? ids.has(nativeCaseId(testCase))
      : !ids.has(nativeCaseId(testCase)),
  );
};
