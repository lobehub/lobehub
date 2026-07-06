'use client';

import {
  type AskUserDraft,
  type AskUserQuestionArgs,
  AskUserQuestionView,
  DRAFT_PLUGIN_STATE_KEY,
  useAskUserForm,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

/**
 * Builtin `askUserQuestion` intervention — the same multi-question form the
 * Claude Code surface uses, wired to the shared `useAskUserForm` +
 * `AskUserQuestionView` (`@lobechat/shared-tool-ui/ask-user`).
 *
 * Unlike Claude Code there is no bridge timeout here, so `countdownMs` is
 * omitted (no countdown, no timeout fallback). This wrapper owns the two
 * app-coupled bits: draft persistence (via the conversation + chat stores) and
 * i18n (generic `askUserQuestion.*` keys).
 *
 * When the card is shown read-only (`interactionMode !== 'custom'`, e.g. a
 * resolved / historical message), it renders a compact summary of the questions
 * instead of the interactive form.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>((props) => {
  const { t } = useTranslation('tool');
  const { actionsPortalTarget, args, interactionMode, messageId, onInteractionAction } = props;

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
    onInteractionAction,
    persistedDraft,
    writeDraft,
  });

  // Read-only surfaces (resolved / historical messages) show a compact summary
  // of what was asked instead of the interactive form.
  if (interactionMode !== 'custom') {
    const questions = args?.questions ?? [];
    return (
      <Flexbox gap={8}>
        {questions.map((q, idx) => (
          <Flexbox gap={2} key={`${q.question}-${idx}`}>
            {q.header && (
              <Text fontSize={12} type="secondary">
                {q.header}
              </Text>
            )}
            <Text>{q.question}</Text>
          </Flexbox>
        ))}
      </Flexbox>
    );
  }

  const labels = {
    customPlaceholder: t('askUserQuestion.customOption.placeholder'),
    escapeBack: t('askUserQuestion.escape.back'),
    escapeEnter: t('askUserQuestion.escape.enter'),
    escapePlaceholder: t('askUserQuestion.escape.placeholder'),
    multiSelectTag: t('askUserQuestion.multiSelectTag'),
    skip: t('askUserQuestion.skip'),
    submit: t('askUserQuestion.submit'),
    timeExpired: '',
    timeRemaining: () => '',
  };

  return (
    <AskUserQuestionView
      {...form}
      actionsPortalTarget={actionsPortalTarget}
      labels={labels}
      showCountdown={false}
    />
  );
});

AskUserQuestionIntervention.displayName = 'AskUserQuestionIntervention';

export default AskUserQuestionIntervention;
