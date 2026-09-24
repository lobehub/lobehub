'use client';

import type { AskUserDraft, AskUserQuestionArgs } from '@lobechat/shared-tool-ui/ask-user';
import {
  AskUserQuestionView,
  DRAFT_PLUGIN_STATE_KEY,
  normalizeAskUserQuestions,
  useAskUserForm,
} from '@lobechat/shared-tool-ui/ask-user';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
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
  const { actionsPortalTarget, args, disabled, interactionMode, messageId, onInteractionAction } =
    props;

  const persistedDraft = useConversationStore((s) => {
    const msg = dataSelectors.getDbMessageById(messageId)(s);
    return (msg?.pluginState as { [DRAFT_PLUGIN_STATE_KEY]?: unknown })?.[DRAFT_PLUGIN_STATE_KEY];
  });
  const setInterventionDraft = useChatStore((s) => s.setInterventionDraft);
  const submissionPhase = useChatStore((s) => s.questionSubmissions[messageId]);
  const checkQuestionSubmission = useChatStore((s) => s.checkQuestionSubmission);
  const context = useConversationStore((s) => s.context);
  const writeDraft = useCallback(
    (draft: AskUserDraft) => setInterventionDraft(messageId, draft),
    [messageId, setInterventionDraft],
  );

  const form = useAskUserForm({
    args,
    disabled,
    onInteractionAction,
    persistedDraft,
    writeDraft,
  });

  // Read-only surfaces (resolved / historical messages) show a compact summary
  // of what was asked instead of the interactive form.
  if (interactionMode !== 'custom') {
    const questions = normalizeAskUserQuestions(args);
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

  if (submissionPhase === 'submitting' || submissionPhase === 'checking') {
    return (
      <Flexbox horizontal align="center" gap={8} padding={8} role="status">
        <NeuralNetworkLoading size={16} />
        <Text type="secondary">
          {t(
            submissionPhase === 'submitting'
              ? 'askUserQuestion.submitting'
              : 'askUserQuestion.checking',
          )}
        </Text>
      </Flexbox>
    );
  }

  if (submissionPhase === 'uncertain') {
    return (
      <Flexbox gap={8} padding={8}>
        <Text role="status">{t('askUserQuestion.uncertain')}</Text>
        <Button onClick={() => checkQuestionSubmission(messageId, context)}>
          {t('askUserQuestion.checkStatus')}
        </Button>
      </Flexbox>
    );
  }

  const labels = {
    customPlaceholder: t('askUserQuestion.customOption.placeholder'),
    escapeBack: t('askUserQuestion.escape.back'),
    escapeEnter: t('askUserQuestion.escape.enter'),
    escapePlaceholder: t('askUserQuestion.escape.placeholder'),
    multiSelectTag: t('askUserQuestion.multiSelectTag'),
    recommendedTag: t('askUserQuestion.recommendedTag'),
    skip: t('askUserQuestion.skip'),
    submit: t('askUserQuestion.submit'),
    supplementEnter: t('askUserQuestion.supplement.enter'),
    supplementPlaceholder: t('askUserQuestion.supplement.placeholder'),
    timeExpired: '',
    timeExpiredNoAnswer: '',
    timeRemaining: () => '',
  };

  return (
    <Flexbox gap={8}>
      {submissionPhase === 'failed' && (
        <Alert title={t('askUserQuestion.submitFailed')} type="error" />
      )}
      <AskUserQuestionView
        {...form}
        actionsPortalTarget={actionsPortalTarget}
        labels={labels}
        showCountdown={false}
      />
    </Flexbox>
  );
});

AskUserQuestionIntervention.displayName = 'AskUserQuestionIntervention';

export default AskUserQuestionIntervention;
