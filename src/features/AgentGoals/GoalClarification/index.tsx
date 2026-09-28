'use client';

import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ClarificationQuestions, {
  type ClarificationAnswer,
} from '@/features/ClarificationQuestions';
import { useGoalStore } from '@/store/goal';

import {
  assumeAll,
  type PendingGoalClarification,
  toClarificationQuestions,
  toDecisionAnswers,
} from './mapping';

export type { PendingGoalClarification } from './mapping';

interface GoalClarificationProps {
  actionsPortalTarget?: HTMLElement | null;
  goalId: string;
  pending: PendingGoalClarification[];
}

/**
 * A goal's clarification round as one form: every question the planner needs
 * answered before work starts, submitted together so the goal re-plans once.
 * Mounted on the goal page and in the global island.
 */
const GoalClarification = memo<GoalClarificationProps>(
  ({ actionsPortalTarget, goalId, pending }) => {
    const { t } = useTranslation('chat');
    const answerGoalClarifications = useGoalStore((s) => s.answerGoalClarifications);

    const questions = useMemo(
      () => toClarificationQuestions(pending, { assume: t('goalProcess.gate.option.assume') }),
      [pending, t],
    );

    const handleSubmit = useCallback(
      (answers: ClarificationAnswer[]) =>
        answerGoalClarifications(goalId, toDecisionAnswers(answers)),
      [answerGoalClarifications, goalId],
    );
    const handleSkip = useCallback(
      () => answerGoalClarifications(goalId, assumeAll(pending)),
      [answerGoalClarifications, goalId, pending],
    );

    return (
      <ClarificationQuestions
        actionsPortalTarget={actionsPortalTarget}
        questions={questions}
        skipLabel={t('goalProcess.clarify.skip')}
        submitLabel={t('goalProcess.clarify.submit')}
        onSkip={handleSkip}
        onSubmit={handleSubmit}
      />
    );
  },
);

GoalClarification.displayName = 'GoalClarification';

export default GoalClarification;
