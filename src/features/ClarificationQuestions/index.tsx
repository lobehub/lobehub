'use client';

import {
  type AskUserDraft,
  AskUserQuestionView,
  useAskUserForm,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ClarificationAnswer,
  type ClarificationQuestion,
  draftToClarificationAnswers,
  toAskUserArgs,
  toClarificationAnswers,
} from './answers';
import { useAskUserLabels } from './useAskUserLabels';

export type { ClarificationAnswer, ClarificationQuestion } from './answers';

export interface ClarificationQuestionsProps {
  /** Portal the Skip/Submit footer into a host-owned footer. */
  actionsPortalTarget?: HTMLElement | null;
  /** Mirror the answers the draft would submit, for hosts that own the result. */
  onAnswersChange?: (answers: ClarificationAnswer[]) => void;
  /** What "skip" means is the host's call: proceed on assumptions, or without answers. */
  onSkip: () => Promise<void> | void;
  onSubmit: (answers: ClarificationAnswer[]) => Promise<void> | void;
  questions: ClarificationQuestion[];
  /** Defaults to `true`; pass `false` when every question is optional. */
  requireAllAnswered?: boolean;
  /** Host wording for the two footer buttons, when "Submit" / "Skip" undersell them. */
  skipLabel?: string;
  submitLabel?: string;
}

/**
 * The one way the product asks the user its own questions.
 *
 * Goal clarification and task intent used to draw their own question cards,
 * each a little different from the AskUserQuestion form agents use in the
 * conversation. This host renders that same form for questions that do not
 * come from a tool call: the draft lives here instead of on a tool message,
 * and the answer comes back as `{ questionId, optionId | text }` rather than
 * a payload keyed by question text.
 */
const ClarificationQuestions = memo<ClarificationQuestionsProps>(
  ({
    actionsPortalTarget,
    onAnswersChange,
    onSkip,
    onSubmit,
    questions,
    requireAllAnswered,
    skipLabel,
    submitLabel,
  }) => {
    const { t } = useTranslation('tool');
    const labels = useAskUserLabels({ skip: skipLabel, submit: submitLabel });
    const [draft, setDraft] = useState<AskUserDraft>();
    const [failed, setFailed] = useState(false);
    const args = useMemo(() => toAskUserArgs(questions), [questions]);

    const writeDraft = useCallback(
      (next: AskUserDraft) => {
        setDraft(next);
        onAnswersChange?.(draftToClarificationAnswers(questions, next));
      },
      [onAnswersChange, questions],
    );

    const onInteractionAction = useCallback<
      NonNullable<BuiltinInterventionProps['onInteractionAction']>
    >(
      async (action) => {
        setFailed(false);
        try {
          if (action.type === 'skip') await onSkip();
          else if (action.type === 'submit')
            await onSubmit(toClarificationAnswers(questions, action.payload ?? {}));
        } catch (error) {
          setFailed(true);
          // Rethrow so the form leaves its submitting state and can be retried.
          throw error;
        }
      },
      [onSkip, onSubmit, questions],
    );

    const form = useAskUserForm({
      args,
      onInteractionAction,
      persistedDraft: draft,
      requireAllAnswered,
      writeDraft,
    });

    if (!labels) return null;

    return (
      <Flexbox gap={8}>
        {failed && <Alert title={t('askUserQuestion.submitFailed')} type="error" />}
        <AskUserQuestionView
          {...form}
          actionsPortalTarget={actionsPortalTarget}
          labels={labels}
          showCountdown={false}
        />
      </Flexbox>
    );
  },
);

ClarificationQuestions.displayName = 'ClarificationQuestions';

export default ClarificationQuestions;
