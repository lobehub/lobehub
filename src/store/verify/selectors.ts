import type { VerifyRubricConfig } from '@lobechat/types';

import { type Store } from './action';
import { type VerifyCriterionEdit } from './initialState';
import {
  acceptanceListKey,
  type AcceptanceListParams,
  acceptancePageKey,
  type AcceptancePageParams,
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

export const verifySelectors = {
  acceptanceBundle,
  acceptanceBySubject,
  acceptanceComments,
  acceptanceList,
  acceptancePage,
  criterionEdit,
  instructionEdit,
  isAcceptanceCommentsConfirmed,
  isAcceptanceListConfirmed,
  isAcceptancePageConfirmed,
  rubricConfigEdit,
  rubricTitleEdit,
  verifyRun,
};
