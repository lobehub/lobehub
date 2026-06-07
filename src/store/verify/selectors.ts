import type { VerifyRubricConfig } from '@lobechat/types';

import { type Store } from './action';
import { type VerifyCriterionEdit } from './initialState';

const EMPTY_EDIT: VerifyCriterionEdit = {};
const EMPTY_RUBRIC_CONFIG: VerifyRubricConfig = {};

const criterionEdit = (criterionId?: string) => (s: Store) =>
  (criterionId ? s.criterionEdits[criterionId] : undefined) ?? EMPTY_EDIT;

const instructionEdit = (documentId?: string) => (s: Store) =>
  documentId ? s.instructionEdits[documentId] : undefined;

const rubricConfigEdit = (rubricId?: string) => (s: Store) =>
  (rubricId ? s.rubricConfigEdits[rubricId] : undefined) ?? EMPTY_RUBRIC_CONFIG;

const rubricTitleEdit = (rubricId?: string) => (s: Store) =>
  rubricId ? s.rubricTitleEdits[rubricId] : undefined;

export const verifySelectors = {
  criterionEdit,
  instructionEdit,
  rubricConfigEdit,
  rubricTitleEdit,
};
