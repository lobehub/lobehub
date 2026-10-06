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

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import {
  type ClarificationAnswer,
  type ClarificationQuestion,
  draftToClarificationAnswers,
  toAskUserArgs,
  toClarificationAnswers,
} from './answers';
import {
  accountDraftKey,
  clearClarificationDraft,
  readClarificationDraft,
  writeClarificationDraft,
} from './draftStorage';
import { useAskUserLabels } from './useAskUserLabels';

export type { ClarificationAnswer, ClarificationQuestion } from './answers';

export interface ClarificationQuestionsProps {
  /** Portal the Skip/Submit footer into a host-owned footer. */
  actionsPortalTarget?: HTMLElement | null;
  /**
   * Keeps unsent answers across unmounts (collapsing the island, leaving the
   * page, reloading). Identify the round, so a new round starts blank.
   */
  draftKey?: string;
  /** Mirror the answers the draft would submit, for hosts that own the result. */
  onAnswersChange?: (answers: ClarificationAnswer[]) => void;
  /**
   * What "skip" means is the host's call: proceed on assumptions, or without
   * answers. A question that must be answered passes none and the form offers
   * no skip at all.
   */
  onSkip?: () => Promise<void> | void;
  onSubmit: (answers: ClarificationAnswer[]) => Promise<void> | void;
  questions: ClarificationQuestion[];
  /** Defaults to `true`; pass `false` when every question is optional. */
  requireAllAnswered?: boolean;
  /** Host wording for the two footer buttons, when "Submit" / "Skip" undersell them. */
  skipLabel?: string;
  submitLabel?: string;
  /** Host wording for the notes box, when its notes go somewhere specific. */
  supplementPlaceholder?: string;
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
    draftKey,
    onAnswersChange,
    onSkip,
    onSubmit,
    questions,
    requireAllAnswered,
    skipLabel,
    submitLabel,
    supplementPlaceholder,
  }) => {
    const { t } = useTranslation('tool');
    const labels = useAskUserLabels({
      skip: onSkip ? skipLabel : '',
      submit: submitLabel,
      supplementPlaceholder,
    });
    const userId = useUserStore(userProfileSelectors.userId);
    const storageKey = accountDraftKey(userId, draftKey);
    const [draft, setDraft] = useState<AskUserDraft | undefined>(() =>
      storageKey ? readClarificationDraft(storageKey) : undefined,
    );
    const [failed, setFailed] = useState(false);
    const args = useMemo(() => toAskUserArgs(questions), [questions]);

    const writeDraft = useCallback(
      (next: AskUserDraft) => {
        setDraft(next);
        if (storageKey) writeClarificationDraft(storageKey, next);
        onAnswersChange?.(draftToClarificationAnswers(questions, next));
      },
      [onAnswersChange, questions, storageKey],
    );

    const onInteractionAction = useCallback<
      NonNullable<BuiltinInterventionProps['onInteractionAction']>
    >(
      async (action) => {
        setFailed(false);
        try {
          if (action.type === 'skip') {
            if (!onSkip) return;
            await onSkip();
          } else if (action.type === 'submit')
            await onSubmit(toClarificationAnswers(questions, action.payload ?? {}));
          // Sent: nothing left to restore. A failed send keeps the draft.
          if (storageKey) clearClarificationDraft(storageKey);
        } catch (error) {
          setFailed(true);
          // Rethrow so the form leaves its submitting state and can be retried.
          throw error;
        }
      },
      [onSkip, onSubmit, questions, storageKey],
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
