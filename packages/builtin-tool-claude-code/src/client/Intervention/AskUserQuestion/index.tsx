'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Check, PenLine, Send, X } from 'lucide-react';
import { memo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';
import { formatRemaining, isQuestionAnswered } from './draft';
import QuestionPanel from './QuestionPanel';
import { useAskUserForm } from './useAskUserForm';

/**
 * CC AskUserQuestion intervention component.
 *
 * Pure form — `onInteractionAction` ({type:'submit'|'skip'}) is the only
 * outbound side effect. The framework's `handleInteractionAction` (or the
 * hetero branch the chat conversation wires up) marks
 * `pluginIntervention.status` and forwards the answer to CC over IPC.
 *
 * Answering a question
 * - Pick one of the numbered options, or
 * - Write your own in the trailing (numbered) input. Single-select treats the
 *   two as mutually exclusive (typing clears the pick and vice-versa);
 *   multi-select appends the custom text as an extra entry alongside the checked
 *   options.
 *
 * Layout
 * - One question → renders the question + options directly, no tab strip, and
 *   no whole-form escape (the per-question custom box already is the full
 *   custom answer).
 * - Multiple questions → top tab bar (Q1, Q2, …) with a trailing "Or type
 *   directly" tab as a visible peer: selecting it swaps all questions for one
 *   freeform box that answers the whole form at once. Picking an answer
 *   auto-advances to the next unanswered question.
 *
 * State, handlers, and draft persistence all live in `useAskUserForm`; this
 * component is just the view.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>((props) => {
  const { t } = useTranslation('tool');
  const { actionsPortalTarget } = props;
  const {
    activeQuestion,
    activeTab,
    custom,
    escapeActive,
    escapeText,
    expired,
    handleCustomChange,
    handleEscapeTextChange,
    handleSkip,
    handleSubmit,
    handleToggle,
    isMulti,
    isSubmitDisabled,
    picks,
    questions,
    remainingMs,
    setActiveTab,
    setEscapeMode,
    submitting,
  } = useAskUserForm(props);

  const footer = (
    <Flexbox horizontal align="center" gap={8} justify="space-between" width={'100%'}>
      <Text fontSize={12} type="secondary">
        {expired
          ? t('claudeCode.askUserQuestion.timeExpired')
          : t('claudeCode.askUserQuestion.timeRemaining', {
              time: formatRemaining(remainingMs),
            })}
      </Text>
      <Flexbox horizontal gap={8}>
        <Button disabled={submitting} icon={<Icon icon={X} />} onClick={handleSkip}>
          {t('claudeCode.askUserQuestion.skip')}
        </Button>
        <Button
          disabled={isSubmitDisabled}
          icon={<Icon icon={Send} />}
          loading={submitting}
          type="primary"
          onClick={handleSubmit}
        >
          {t('claudeCode.askUserQuestion.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Flexbox gap={12}>
      {isMulti && (
        <Tabs
          activeKey={escapeActive ? 'escape' : activeTab}
          variant="square"
          items={[
            ...questions.map((q, idx) => {
              const done = isQuestionAnswered(q, picks, custom);
              return {
                key: String(idx),
                label: (
                  <Flexbox horizontal align="center" gap={6}>
                    <Text>Q{idx + 1}</Text>
                    {done && <Icon icon={Check} size={12} />}
                  </Flexbox>
                ),
              };
            }),
            // The whole-form freeform sits as a visible peer to the questions —
            // it replaces *all* of them, so it reads as a sibling choice, not a
            // hidden mode toggle.
            {
              key: 'escape',
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <Icon icon={PenLine} size={12} />
                  <Text>{t('claudeCode.askUserQuestion.escape.enter')}</Text>
                </Flexbox>
              ),
            },
          ]}
          onChange={(key: string) => {
            if (key === 'escape') {
              setEscapeMode(true);
            } else {
              setEscapeMode(false);
              setActiveTab(key);
            }
          }}
        />
      )}

      {escapeActive ? (
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          disabled={expired || submitting}
          placeholder={t('claudeCode.askUserQuestion.escape.placeholder')}
          value={escapeText}
          variant="filled"
          onChange={(e) => handleEscapeTextChange(e.target.value)}
        />
      ) : (
        activeQuestion && (
          <QuestionPanel
            answer={picks[activeQuestion.question]}
            customValue={custom[activeQuestion.question] ?? ''}
            disabled={expired || submitting}
            question={activeQuestion}
            onCustomChange={handleCustomChange}
            onToggle={handleToggle}
          />
        )
      )}

      {actionsPortalTarget ? createPortal(footer, actionsPortalTarget) : footer}
    </Flexbox>
  );
});

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
