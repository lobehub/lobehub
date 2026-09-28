import { GOAL_CLARIFICATION_OPTION, GOAL_CLARIFICATION_TITLE } from '@lobechat/const/goal';
import type { GoalClarificationAnswer } from '@lobechat/prompts';
import type {
  GoalDecisionOption,
  GoalGraphSnapshot,
  GoalUnderstandingLevel,
} from '@lobechat/types';

import type { GoalDecompositionDraft } from './criteriaGenerator';

const MAX_QUESTIONS = 3;

/**
 * Stored on the problem node's `confidence` column. The level is what
 * decisions read; the number only exists because the column is numeric.
 */
export const UNDERSTANDING_CONFIDENCE: Record<GoalUnderstandingLevel, number> = {
  high: 0.9,
  low: 0.3,
  medium: 0.6,
};

export interface ClarificationQuestion {
  assumption: string;
  impact?: string;
  options: string[];
  question: string;
}

export interface GoalUnderstandingPlan {
  /** Questions to put to the user before any Task is created; empty means proceed. */
  ask: ClarificationQuestion[];
  assumptions: string[];
  level: GoalUnderstandingLevel;
}

/** Whether the coordinator already put its clarification round to the user. */
export const hasAskedClarification = (graph: GoalGraphSnapshot): boolean =>
  graph.nodes.some((node) => node.kind === 'decision' && node.title === GOAL_CLARIFICATION_TITLE);

/**
 * Turn what the planner reported into what the coordinator does.
 *
 * The level is derived, never self-rated: a planner that lists a blocking
 * question has by its own account found something it cannot decide, so the
 * user is asked — once. The second plan proceeds on its assumptions whatever
 * it reports, so a goal can never loop on its own questions.
 */
/** Compare questions the way a user would: case, spacing and closing punctuation don't count. */
const questionKey = (question: string) =>
  question
    .trim()
    .toLowerCase()
    .replace(/[\s?？.。!！]+$/u, '');

export const normalizeUnderstanding = (
  plan: Pick<GoalDecompositionDraft, 'assumptions' | 'questions'>,
  alreadyAsked: boolean,
  answeredQuestions: string[] = [],
): GoalUnderstandingPlan => {
  // A re-plan that repeats an answered question would otherwise record its
  // fallback as an assumption — one that contradicts what the user just said.
  const answered = new Set(answeredQuestions.map(questionKey));
  const questions = (plan.questions ?? [])
    .map((item) => ({
      assumption: item.assumption.trim(),
      blocking: item.blocking,
      impact: item.impact?.trim() || undefined,
      options: (item.options ?? []).map((option) => option.trim()).filter(Boolean),
      question: item.question.trim(),
    }))
    .filter((item) => item.question && !answered.has(questionKey(item.question)))
    // The same question twice would be asked as two decisions sharing one answer.
    .filter(
      (item, index, all) =>
        all.findIndex((other) => questionKey(other.question) === questionKey(item.question)) ===
        index,
    )
    .slice(0, MAX_QUESTIONS);

  const ask = alreadyAsked ? [] : questions.filter((item) => item.blocking);
  const asked = new Set(ask);
  // A question that is not put to the user still shapes the plan: its fallback
  // becomes an assumption the user can see and correct.
  const assumptions = [
    ...(plan.assumptions ?? []).map((item) => item.trim()),
    ...questions.filter((item) => !asked.has(item)).map((item) => item.assumption),
  ].filter(Boolean);

  return {
    ask: ask.map(({ blocking: _, ...item }) => item),
    assumptions: [...new Set(assumptions)],
    level: ask.length > 0 ? 'low' : assumptions.length > 0 ? 'medium' : 'high',
  };
};

/** The planner's choices plus the two answers every clarification accepts. */
export const clarificationOptions = (question: ClarificationQuestion): GoalDecisionOption[] => [
  ...question.options.map((label, index) => ({ id: `option-${index + 1}`, label })),
  {
    description: question.assumption,
    id: GOAL_CLARIFICATION_OPTION.assume,
    label: 'Go with the assumption',
  },
  { id: GOAL_CLARIFICATION_OPTION.answer, label: 'Answer with my note' },
];

/**
 * Read the user's answers back off the graph for the re-plan.
 *
 * Built from the resolved decisions rather than stored separately, so the
 * answer the planner sees is always the one the audit trail recorded.
 */
export const collectClarificationAnswers = (
  graph: GoalGraphSnapshot,
): GoalClarificationAnswer[] => {
  const clarificationNodeIds = new Set(
    graph.nodes
      .filter((node) => node.kind === 'decision' && node.title === GOAL_CLARIFICATION_TITLE)
      .map((node) => node.id),
  );

  return graph.decisions
    .filter(
      (decision) =>
        decision.status === 'resolved' &&
        clarificationNodeIds.has(decision.nodeId) &&
        decision.resolvedOptionId,
    )
    .map((decision) => {
      const option = decision.options?.find((item) => item.id === decision.resolvedOptionId);
      const note = decision.resolution?.trim();
      let answer: string;
      if (decision.resolvedOptionId === GOAL_CLARIFICATION_OPTION.assume) {
        answer = `No preference — proceed with: ${option?.description ?? 'your stated assumption'}`;
      } else if (decision.resolvedOptionId === GOAL_CLARIFICATION_OPTION.answer) {
        answer = note ?? '';
      } else {
        answer = option?.label ?? decision.resolvedOptionId!;
      }
      // A note on a chosen option is extra guidance, not a replacement for it.
      if (note && decision.resolvedOptionId !== GOAL_CLARIFICATION_OPTION.answer)
        answer = `${answer} (${note})`;
      return { answer, question: decision.question };
    })
    .filter((item) => item.answer);
};
