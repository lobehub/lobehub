import type { VerifierType, VerifyOnFailStrategy, VerifyRubricConfig } from '@lobechat/types';

/** The criterion fields the portal can edit. */
export interface VerifyCriterionEdit {
  description?: string;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
  title?: string;
  verifierType?: VerifierType;
}

export interface State {
  /**
   * Per-criterion edit overlay, keyed by `verify_criteria.id`. Holds the
   * user's in-flight edits so the UI reflects them immediately while they are
   * debounced-persisted to the backend.
   */
  criterionEdits: Record<string, VerifyCriterionEdit>;
  /**
   * Per-instruction edit overlay, keyed by the instruction document id. Holds
   * the latest rubric text pending a debounced document save.
   */
  instructionEdits: Record<string, string>;
  /**
   * Per-rubric run-policy edit overlay, keyed by `verify_rubrics.id`. Holds the
   * in-flight config edits (e.g. maxRepairRounds) pending a debounced save.
   */
  rubricConfigEdits: Record<string, VerifyRubricConfig>;
  /**
   * Per-rubric title edit overlay, keyed by `verify_rubrics.id`. Holds the
   * in-flight delivery-standard rename pending a debounced save.
   */
  rubricTitleEdits: Record<string, string>;
}

export const initialState: State = {
  criterionEdits: {},
  instructionEdits: {},
  rubricConfigEdits: {},
  rubricTitleEdits: {},
};
