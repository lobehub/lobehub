import type {
  AcceptanceCommentList,
  VerifierType,
  VerifyOnFailStrategy,
  VerifyRubricConfig,
} from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { AcceptanceBundle, AcceptanceBySubject, AcceptanceListItem } from '@/services/verify';

import type { AcceptancePageData, VerifyRunSnapshot } from './projection';

/** The criterion fields the portal can edit. */
export interface VerifyCriterionEdit {
  description?: string;
  onFail?: VerifyOnFailStrategy;
  required?: boolean;
  title?: string;
  verifierType?: VerifierType;
}

export interface State {
  /** Replica view of the acceptance bundles, one entry per acceptance id. */
  acceptanceBundleMap: Record<string, AcceptanceBundle>;
  /** Replica bookkeeping of `acceptanceBundleMap`. */
  acceptanceBundleReplica: ReplicaState<AcceptanceBundle>;
  /** Replica view of the subject attachments, one entry per `<subjectType>:<subjectId>`. */
  acceptanceBySubjectMap: Record<string, AcceptanceBySubject>;
  /** Replica bookkeeping of `acceptanceBySubjectMap`. */
  acceptanceBySubjectReplica: ReplicaState<AcceptanceBySubject>;
  /** Replica view of each acceptance's discussion, keyed by acceptance id. */
  acceptanceCommentMap: Record<string, AcceptanceCommentList>;
  /** Replica bookkeeping of `acceptanceCommentMap`. */
  acceptanceCommentReplica: ReplicaState<AcceptanceCommentList>;
  /** Replica view of the flat acceptance list reads, keyed by `acceptanceListKey`. */
  acceptanceListMap: Record<string, AcceptanceListItem[]>;
  /** Replica bookkeeping of `acceptanceListMap`. */
  acceptanceListReplica: ReplicaState<AcceptanceListItem[]>;
  /** Replica view of the list panel's scroll feeds, keyed by `acceptancePageKey`. */
  acceptancePageMap: Record<string, AcceptancePageData>;
  /** Replica bookkeeping of `acceptancePageMap`. */
  acceptancePageReplica: ReplicaState<AcceptancePageData>;
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
  /** Replica view of the Agent Run verify cards, one entry per operation id. */
  verifyRunMap: Record<string, VerifyRunSnapshot>;
  /** Replica bookkeeping of `verifyRunMap`. */
  verifyRunReplica: ReplicaState<VerifyRunSnapshot>;
}

export const initialState: State = {
  acceptanceBundleMap: {},
  acceptanceBundleReplica: createReplicaState(),
  acceptanceBySubjectMap: {},
  acceptanceBySubjectReplica: createReplicaState(),
  acceptanceCommentMap: {},
  acceptanceCommentReplica: createReplicaState(),
  acceptanceListMap: {},
  acceptanceListReplica: createReplicaState(),
  acceptancePageMap: {},
  acceptancePageReplica: createReplicaState(),
  criterionEdits: {},
  instructionEdits: {},
  rubricConfigEdits: {},
  rubricTitleEdits: {},
  verifyRunMap: {},
  verifyRunReplica: createReplicaState(),
};
