'use client';

import {
  type AskUserDraft,
  type AskUserQuestionArgs,
  AskUserQuestionView,
  DEFAULT_COUNTDOWN_MS,
  DRAFT_PLUGIN_STATE_KEY,
  useAskUserForm,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

/**
 * CC AskUserQuestion intervention component.
 *
 * A thin host wrapper around the shared `useAskUserForm` + `AskUserQuestionView`
 * (in `@lobechat/shared-tool-ui/ask-user`). This wrapper owns the two
 * app-coupled bits the shared module intentionally does not:
 *   - draft persistence — read from / written to the tool message's
 *     `pluginState.askUserDraft` via the conversation + chat stores, so HMR,
 *     remounts, and tab switches resume where the user left off, and
 *   - i18n — the `labels` built from CC's `claudeCode.askUserQuestion.*` keys.
 *
 * Everything else (pick/custom/escape/auto-advance/submit, the countdown, the
 * timeout fallback, and the `__freeform__` bridge) lives in the shared hook.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>((props) => {
  const { t } = useTranslation('tool');
  const { actionsPortalTarget, args, messageId, onInteractionAction } = props;

  // Persisted draft — read from the tool message's pluginState so the form
  // stays where the user left it across unmount / HMR / refresh.
  const persistedDraft = useConversationStore((s) => {
    const msg = dataSelectors.getDbMessageById(messageId)(s);
    return (msg?.pluginState as { [DRAFT_PLUGIN_STATE_KEY]?: unknown })?.[DRAFT_PLUGIN_STATE_KEY];
  });
  const setInterventionDraft = useChatStore((s) => s.setInterventionDraft);
  const writeDraft = useCallback(
    (draft: AskUserDraft) => setInterventionDraft(messageId, draft),
    [messageId, setInterventionDraft],
  );

  const form = useAskUserForm({
    args,
    countdownMs: DEFAULT_COUNTDOWN_MS,
    onInteractionAction,
    persistedDraft,
    writeDraft,
  });

  const labels = {
    customPlaceholder: t('claudeCode.askUserQuestion.customOption.placeholder'),
    escapeBack: t('claudeCode.askUserQuestion.escape.back'),
    escapeEnter: t('claudeCode.askUserQuestion.escape.enter'),
    escapePlaceholder: t('claudeCode.askUserQuestion.escape.placeholder'),
    multiSelectTag: t('claudeCode.askUserQuestion.multiSelectTag'),
    skip: t('claudeCode.askUserQuestion.skip'),
    submit: t('claudeCode.askUserQuestion.submit'),
    timeExpired: t('claudeCode.askUserQuestion.timeExpired'),
    timeRemaining: (time: string) => t('claudeCode.askUserQuestion.timeRemaining', { time }),
  };

  return (
    <AskUserQuestionView
      {...form}
      showCountdown
      actionsPortalTarget={actionsPortalTarget}
      labels={labels}
    />
  );
});

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
