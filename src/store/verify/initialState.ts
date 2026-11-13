import type {
  AcceptanceCommentList,
  UserSkillVersionDetail,
  VerifierType,
  VerifyOnFailStrategy,
  VerifyRubricConfig,
} from '@lobechat/types';

import type { VerifyCriterionItem, VerifyRubricItem } from '@/database/schemas/verify';
import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { UserSkillDetail } from '@/services/userSkill';
import type {
  AcceptanceBundle,
  AcceptanceBySubject,
  AcceptanceListItem,
  GoalCriterionWithInstruction,
  VerifyReportBundle,
} from '@/services/verify';

import type {
  AcceptancePageData,
  VerifierTracing,
  VerifyLookup,
  VerifyRunSnapshot,
} from './projection';

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
  /** Replica view of a Goal's acceptance criteria, keyed by the joined criteria ids. */
  goalCriteriaMap: Record<string, GoalCriterionWithInstruction[]>;
  /** Replica bookkeeping of `goalCriteriaMap`. */
  goalCriteriaReplica: ReplicaState<GoalCriterionWithInstruction[]>;
  /**
   * Per-instruction edit overlay, keyed by the instruction document id. Holds
   * the latest rubric text pending a debounced document save.
   */
  instructionEdits: Record<string, string>;
  /** Replica view of the plan skills under review, keyed by skill id. */
  planSkillMap: Record<string, VerifyLookup<UserSkillDetail>>;
  /** Replica bookkeeping of `planSkillMap`. */
  planSkillReplica: ReplicaState<VerifyLookup<UserSkillDetail>>;
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
  /** Replica view of shipped skill versions, keyed `<skillId>@<version>`. */
  skillVersionMap: Record<string, VerifyLookup<UserSkillVersionDetail>>;
  /** Replica bookkeeping of `skillVersionMap`. */
  skillVersionReplica: ReplicaState<VerifyLookup<UserSkillVersionDetail>>;
  /** Replica view of LLM verifier tracings, keyed by tracing id. */
  verifierTracingMap: Record<string, VerifyLookup<VerifierTracing>>;
  /** Replica bookkeeping of `verifierTracingMap`. */
  verifierTracingReplica: ReplicaState<VerifyLookup<VerifierTracing>>;
  /** Replica view of standalone verify reports, keyed by verify run id. */
  verifyReportBundleMap: Record<string, VerifyLookup<VerifyReportBundle>>;
  /** Replica bookkeeping of `verifyReportBundleMap`. */
  verifyReportBundleReplica: ReplicaState<VerifyLookup<VerifyReportBundle>>;
  /** Replica view of the criteria each rubric groups, keyed by rubric id. */
  verifyRubricCriteriaMap: Record<string, VerifyCriterionItem[]>;
  /** Replica bookkeeping of `verifyRubricCriteriaMap`. */
  verifyRubricCriteriaReplica: ReplicaState<VerifyCriterionItem[]>;
  /** Replica view of the rubric templates (`verifyRubricListMap.all`). */
  verifyRubricListMap: Record<string, VerifyRubricItem[]>;
  /** Replica bookkeeping of `verifyRubricListMap`. */
  verifyRubricListReplica: ReplicaState<VerifyRubricItem[]>;
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
  goalCriteriaMap: {},
  goalCriteriaReplica: createReplicaState(),
  instructionEdits: {},
  planSkillMap: {},
  planSkillReplica: createReplicaState(),
  rubricConfigEdits: {},
  rubricTitleEdits: {},
  skillVersionMap: {},
  skillVersionReplica: createReplicaState(),
  verifierTracingMap: {},
  verifierTracingReplica: createReplicaState(),
  verifyReportBundleMap: {},
  verifyReportBundleReplica: createReplicaState(),
  verifyRubricCriteriaMap: {},
  verifyRubricCriteriaReplica: createReplicaState(),
  verifyRubricListMap: {},
  verifyRubricListReplica: createReplicaState(),
  verifyRunMap: {},
  verifyRunReplica: createReplicaState(),
};
