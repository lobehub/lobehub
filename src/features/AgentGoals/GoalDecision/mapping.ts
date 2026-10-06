import {
  GOAL_CLARIFICATION_OPTION,
  GOAL_CLARIFICATION_TITLE,
  GOAL_MACHINE_GATE_TITLE,
  GOAL_MANAGER_QUESTION_TITLE,
} from '@lobechat/const/goal';
import type { GoalDecisionOption } from '@lobechat/types';

import type {
  ClarificationAnswer,
  ClarificationQuestion,
} from '@/features/ClarificationQuestions/answers';

/**
 * What kind of thing a gate asks, which decides how it is framed:
 * - `machine` — the setup is broken or the automatic retries are spent; the
 *   owner fixes something, nothing about the work is in question
 * - `judgment` — the coordinator stopped on a failure only the owner can weigh
 * - `goalAcceptance` — the goal's own acceptance ended unmet
 * - `agentQuestion` — the main Agent asked a concrete question with its own answers
 * - `clarify` — a clarification round, asked as its own form
 */
export type GoalGateCategory =
  'agentQuestion' | 'clarify' | 'goalAcceptance' | 'judgment' | 'machine';

/** The ids the coordinator writes on its own gates; anything else is an Agent's answer. */
const COORDINATOR_OPTION_IDS = new Set(['fail', 'retire', 'retry']);

export const goalGateCategory = (gate: {
  nodeTitle?: string | null;
  options?: GoalDecisionOption[] | null;
}): GoalGateCategory => {
  if (gate.nodeTitle === GOAL_CLARIFICATION_TITLE) return 'clarify';
  if (gate.nodeTitle === GOAL_MANAGER_QUESTION_TITLE) return 'agentQuestion';
  if (gate.nodeTitle === GOAL_MACHINE_GATE_TITLE) return 'machine';
  const options = gate.options ?? [];
  // A takeover question rides the failed Task's gate, so its title is the
  // coordinator's; its answers are what give it away.
  if (options.some((option) => !COORDINATOR_OPTION_IDS.has(option.id))) return 'agentQuestion';
  if (options.some((option) => option.id === 'fail')) return 'goalAcceptance';
  return 'judgment';
};

export interface GoalGateDecision {
  id: string;
  options?: GoalDecisionOption[] | null;
  question: string;
  recommendedOptionId?: string | null;
}

/**
 * One gate as one AskUserQuestion question: the question in the reader's
 * words, the evidence it stands on underneath, and each answer with what it
 * does. The coordinator's own answers get their consequence from `describe`;
 * an Agent's answers carry their own.
 */
export const toGateQuestion = (
  decision: GoalGateDecision,
  copy: {
    basis?: string | null;
    describe: (option: GoalDecisionOption) => string | undefined;
    label: (option: GoalDecisionOption) => string;
    question: string;
  },
): ClarificationQuestion => ({
  ...(copy.basis ? { description: copy.basis } : {}),
  header: '',
  id: decision.id,
  options: (decision.options ?? [])
    .filter((option) => option.id !== GOAL_CLARIFICATION_OPTION.answer)
    .map((option) => {
      const description = option.description ?? copy.describe(option);
      return {
        ...(description ? { description } : {}),
        id: option.id,
        label: copy.label(option),
        ...(option.id === decision.recommendedOptionId ? { recommended: true } : {}),
      };
    }),
  question: copy.question,
});

/**
 * Which option a written-out answer stands for. A gate has no "other" answer
 * of its own, so words with no pick go with the option that carries guidance
 * forward — an explicit free answer, then whatever retries, then the advised
 * one — and become its note.
 */
const optionForWrittenAnswer = (options: GoalDecisionOption[], recommended?: string | null) =>
  options.find((option) => option.id === GOAL_CLARIFICATION_OPTION.answer) ??
  options.find((option) => option.effect === 'retry' || option.id === 'retry') ??
  options.find((option) => option.id === recommended) ??
  options[0];

export const toGateAnswer = (
  decision: GoalGateDecision,
  answers: ClarificationAnswer[],
): { optionId: string; resolution?: string } | undefined => {
  const answer = answers.find((item) => item.questionId === decision.id) ?? answers[0];
  if (!answer) return undefined;
  if (answer.type === 'option') return { optionId: answer.optionId, resolution: answer.note };
  const option = optionForWrittenAnswer(decision.options ?? [], decision.recommendedOptionId);
  return option ? { optionId: option.id, resolution: answer.text } : undefined;
};
