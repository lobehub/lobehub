import type { VerifyRubricConfig } from '@lobechat/types';

import { type Store } from './action';
import { type VerifyCriterionEdit } from './initialState';
import {
  acceptanceListKey,
  type AcceptanceListParams,
  acceptancePageKey,
  type AcceptancePageParams,
  goalCriteriaKey,
  skillVersionKey,
  type SkillVersionParams,
  VERIFY_RUBRIC_LIST_KEY,
} from './projection';

const EMPTY_EDIT: VerifyCriterionEdit = {};
const EMPTY_RUBRIC_CONFIG: VerifyRubricConfig = {};

const acceptanceBundle = (acceptanceId?: string | null) => (s: Store) =>
  acceptanceId ? s.acceptanceBundleMap[acceptanceId] : undefined;

const acceptanceBySubject = (subjectType: string, subjectId?: string | null) => (s: Store) =>
  subjectId ? s.acceptanceBySubjectMap[`${subjectType}:${subjectId}`] : undefined;

const acceptanceList = (params?: AcceptanceListParams | null) => (s: Store) =>
  params ? s.acceptanceListMap[acceptanceListKey(params)] : undefined;

/** The server answered this list read in this session (not only the persisted copy). */
const isAcceptanceListConfirmed = (params?: AcceptanceListParams | null) => (s: Store) =>
  !!params && s.acceptanceListReplica.entries[acceptanceListKey(params)]?.source === 'server';

const acceptancePage = (params?: AcceptancePageParams | null) => (s: Store) =>
  params ? s.acceptancePageMap[acceptancePageKey(params)] : undefined;

/** The server answered this feed's head page in this session. */
const isAcceptancePageConfirmed = (params?: AcceptancePageParams | null) => (s: Store) =>
  !!params && s.acceptancePageReplica.entries[acceptancePageKey(params)]?.source === 'server';

const acceptanceComments = (acceptanceId?: string | null) => (s: Store) =>
  acceptanceId ? s.acceptanceCommentMap[acceptanceId] : undefined;

/** The server answered this discussion in this session. */
const isAcceptanceCommentsConfirmed = (acceptanceId?: string | null) => (s: Store) =>
  !!acceptanceId && s.acceptanceCommentReplica.entries[acceptanceId]?.source === 'server';

const criterionEdit = (criterionId?: string) => (s: Store) =>
  (criterionId ? s.criterionEdits[criterionId] : undefined) ?? EMPTY_EDIT;

const instructionEdit = (documentId?: string) => (s: Store) =>
  documentId ? s.instructionEdits[documentId] : undefined;

const rubricConfigEdit = (rubricId?: string) => (s: Store) =>
  (rubricId ? s.rubricConfigEdits[rubricId] : undefined) ?? EMPTY_RUBRIC_CONFIG;

const rubricTitleEdit = (rubricId?: string) => (s: Store) =>
  rubricId ? s.rubricTitleEdits[rubricId] : undefined;

const verifyRun = (operationId?: string | null) => (s: Store) =>
  operationId ? s.verifyRunMap[operationId] : undefined;

/**
 * A list restored from IndexedDB is not a server answer: an empty snapshot
 * (or one from before the last edit) must read as "still loading", not as
 * "nothing here", until this session's request confirms it.
 */
const confirmedList =
  <T>(
    pick: (s: Store) => { entries: Record<string, { source: string }> },
    map: (s: Store) => Record<string, T[]>,
    key: string | undefined,
  ) =>
  (s: Store): T[] | undefined => {
    if (!key) return undefined;
    const list = map(s)[key];
    if (!list) return undefined;
    if (list.length === 0 && pick(s).entries[key]?.source !== 'server') return undefined;
    return list;
  };

/** The verify report; `null` once the server answered there is none. */
const verifyReportBundle = (verifyRunId?: string | null) => (s: Store) =>
  verifyRunId ? s.verifyReportBundleMap[verifyRunId]?.value : undefined;

const verifierTracing = (tracingId?: string | null) => (s: Store) =>
  tracingId ? s.verifierTracingMap[tracingId]?.value : undefined;

const verifyRubrics = confirmedList(
  (s) => s.verifyRubricListReplica,
  (s) => s.verifyRubricListMap,
  VERIFY_RUBRIC_LIST_KEY,
);

const verifyRubricCriteria = (rubricId?: string | null) =>
  confirmedList(
    (s) => s.verifyRubricCriteriaReplica,
    (s) => s.verifyRubricCriteriaMap,
    rubricId || undefined,
  );

const goalCriteria = (criteriaIds: string[]) =>
  confirmedList(
    (s) => s.goalCriteriaReplica,
    (s) => s.goalCriteriaMap,
    criteriaIds.length > 0 ? goalCriteriaKey(criteriaIds) : undefined,
  );

/** The plan skill; `null` once the server answered it is gone. */
const planSkill = (skillId?: string | null) => (s: Store) =>
  skillId ? s.planSkillMap[skillId]?.value : undefined;

/** One shipped skill version; `null` once the server answered it has none. */
const skillVersion = (params: SkillVersionParams | null) => (s: Store) =>
  params ? s.skillVersionMap[skillVersionKey(params)]?.value : undefined;

export const verifySelectors = {
  acceptanceBundle,
  acceptanceBySubject,
  acceptanceComments,
  acceptanceList,
  acceptancePage,
  criterionEdit,
  goalCriteria,
  instructionEdit,
  isAcceptanceCommentsConfirmed,
  isAcceptanceListConfirmed,
  isAcceptancePageConfirmed,
  planSkill,
  rubricConfigEdit,
  rubricTitleEdit,
  skillVersion,
  verifierTracing,
  verifyReportBundle,
  verifyRubricCriteria,
  verifyRubrics,
  verifyRun,
};
