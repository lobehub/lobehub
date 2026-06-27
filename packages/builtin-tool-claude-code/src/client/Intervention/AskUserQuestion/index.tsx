'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Icon, Tabs, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowLeft, Check, PenLine, Send, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs } from '../../../types';
import { formatRemaining, isQuestionAnswered } from './draft';
import QuestionPanel from './QuestionPanel';
import { useAskUserForm } from './useAskUserForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // "Or type directly" / "Back to options" link — slim secondary text that
  // sits alongside Skip in the action bar; matches the `lobe-user-interaction`
  // escape-toggle styling so the two flows feel like the same control.
  escapeLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    transition: color 0.12s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

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
 * - Write your own in the trailing input. Single-select treats the two as
 *   mutually exclusive (typing clears the pick and vice-versa); multi-select
 *   appends the custom text as an extra entry alongside the checked options.
 *
 * Layout
 * - One question → renders the question + options directly, no tab strip.
 * - Multiple questions → top tab bar (Q1, Q2, …), one panel at a time. Picking
 *   an answer auto-advances to the next unanswered question.
 *
 * State, handlers, and draft persistence all live in `useAskUserForm`; this
 * component is just the view.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>((props) => {
  const { t } = useTranslation('tool');
  const {
    activeQuestion,
    activeTab,
    custom,
    escapeActive,
    escapeText,
    expired,
    handleCustomChange,
    handleEscapeTextChange,
    handleEscapeToggle,
    handleSkip,
    handleSubmit,
    handleToggle,
    isMulti,
    isSubmitDisabled,
    picks,
    questions,
    remainingMs,
    setActiveTab,
    submitting,
  } = useAskUserForm(props);

  return (
    <Flexbox gap={12}>
      {!escapeActive && isMulti && (
        <Tabs
          activeKey={activeTab}
          items={questions.map((q, idx) => {
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
          })}
          onChange={(key: string) => setActiveTab(key)}
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

      <Flexbox horizontal align="center" gap={8} justify="space-between">
        <Flexbox horizontal align="center" gap={12}>
          {escapeActive ? (
            <Text
              className={styles.escapeLink}
              fontSize={12}
              type="secondary"
              onClick={expired || submitting ? undefined : handleEscapeToggle}
            >
              <Icon icon={ArrowLeft} size={12} />
              {t('claudeCode.askUserQuestion.escape.back')}
            </Text>
          ) : (
            <Text
              className={styles.escapeLink}
              fontSize={12}
              type="secondary"
              onClick={expired || submitting ? undefined : handleEscapeToggle}
            >
              {t('claudeCode.askUserQuestion.escape.enter')}
              <Icon icon={PenLine} size={12} />
            </Text>
          )}
          <Text fontSize={12} type="secondary">
            {expired
              ? t('claudeCode.askUserQuestion.timeExpired')
              : t('claudeCode.askUserQuestion.timeRemaining', {
                  time: formatRemaining(remainingMs),
                })}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button disabled={submitting} icon={X} onClick={handleSkip}>
            {t('claudeCode.askUserQuestion.skip')}
          </Button>
          <Button
            disabled={isSubmitDisabled}
            icon={Send}
            loading={submitting}
            type="primary"
            onClick={handleSubmit}
          >
            {t('claudeCode.askUserQuestion.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
