import { GOAL_CLARIFICATION_OPTION } from '@lobechat/const/goal';
import type { GoalDecisionOption } from '@lobechat/types';

import type {
  ClarificationAnswer,
  ClarificationQuestion,
} from '@/features/ClarificationQuestions/answers';

/** One pending clarification, as both the goal graph and the pending list carry it. */
export interface PendingGoalClarification {
  decisionId: string;
  /** What changes with the answer. */
  description?: string | null;
  options: GoalDecisionOption[] | null;
  question: string;
}

export interface GoalDecisionAnswer {
  decisionId: string;
  optionId: string;
  resolution?: string;
}

/**
 * Present a goal's clarification decisions as one AskUserQuestion form.
 *
 * The planner's choices stay as they are; the "go with the assumption" option
 * keeps its id so the server records it as such, and shows the assumption
 * itself as its description. The "answer with my note" option is dropped — the
 * form's own write-your-own row is that answer.
 */
export const toClarificationQuestions = (
  pending: PendingGoalClarification[],
  labels: { assume: string },
): ClarificationQuestion[] =>
  pending.map((item) => ({
    description: item.description ?? undefined,
    // The form already tabs its questions Q1, Q2…; a header here would only
    // repeat that above the question.
    header: '',
    id: item.decisionId,
    options: (item.options ?? [])
      .filter((option) => option.id !== GOAL_CLARIFICATION_OPTION.answer)
      .map((option) =>
        option.id === GOAL_CLARIFICATION_OPTION.assume
          ? { description: option.description, id: option.id, label: labels.assume }
          : { description: option.description, id: option.id, label: option.label },
      ),
    question: item.question,
  }));

export const toDecisionAnswers = (answers: ClarificationAnswer[]): GoalDecisionAnswer[] =>
  answers.map((answer) =>
    answer.type === 'option'
      ? { decisionId: answer.questionId, optionId: answer.optionId, resolution: answer.note }
      : {
          decisionId: answer.questionId,
          optionId: GOAL_CLARIFICATION_OPTION.answer,
          resolution: answer.text,
        },
  );

/** Skipping the round means letting the agent proceed on what it assumed. */
export const assumeAll = (pending: PendingGoalClarification[]): GoalDecisionAnswer[] =>
  pending.map((item) => ({
    decisionId: item.decisionId,
    optionId: GOAL_CLARIFICATION_OPTION.assume,
  }));
