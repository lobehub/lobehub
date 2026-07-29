'use client';

import { Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Check, PenLine, Send, X } from 'lucide-react';
import { memo } from 'react';
import { createPortal } from 'react-dom';

import { formatRemaining, isQuestionAnswered } from './draft';
import QuestionPanel from './QuestionPanel';
import type { AskUserFormApi } from './useAskUserForm';

/**
 * All display strings the view needs. Kept i18n-free so `shared-tool-ui` stays
 * app-decoupled — each host builds this from its own namespace (Claude Code
 * uses its `claudeCode.askUserQuestion.*` keys, the builtin surface uses the
 * generic `askUserQuestion.*` keys).
 */
export interface AskUserQuestionLabels {
  customPlaceholder: string;
  /** "Back to options" — reserved for hosts that render a back affordance. */
  escapeBack: string;
  escapeEnter: string;
  escapePlaceholder: string;
  multiSelectTag: string;
  skip: string;
  submit: string;
  timeExpired: string;
  timeRemaining: (time: string) => string;
}

export interface AskUserQuestionViewProps extends AskUserFormApi {
  /** Portal the Skip/Submit footer here so it stays pinned below the scroll. */
  actionsPortalTarget?: HTMLElement | null;
  labels: AskUserQuestionLabels;
  /** Render the countdown text in the footer (only when a countdown is active). */
  showCountdown: boolean;
}

/**
 * The presentational shell for AskUserQuestion:
 * - a top tab strip (Q1, Q2, … + a trailing "Or type directly" escape tab) when
 *   there is more than one question,
 * - the active `QuestionPanel` (or the whole-form escape TextArea), and
 * - a Skip/Submit footer with an optional countdown.
 *
 * All state and handlers arrive via props (from `useAskUserForm`); this
 * component is pure view and holds no state of its own.
 */
export const AskUserQuestionView = memo<AskUserQuestionViewProps>((props) => {
  const {
    actionsPortalTarget,
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
    labels,
    picks,
    questions,
    remainingMs,
    setActiveTab,
    setEscapeMode,
    showCountdown,
    submitting,
  } = props;

  const footer = (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      justify={showCountdown ? 'space-between' : 'flex-end'}
      width={'100%'}
    >
      {showCountdown && (
        <Text fontSize={12} type="secondary">
          {expired ? labels.timeExpired : labels.timeRemaining(formatRemaining(remainingMs))}
        </Text>
      )}
      <Flexbox horizontal gap={8}>
        <Button disabled={submitting} icon={<Icon icon={X} />} onClick={handleSkip}>
          {labels.skip}
        </Button>
        <Button
          disabled={isSubmitDisabled}
          icon={<Icon icon={Send} />}
          loading={submitting}
          type="primary"
          onClick={handleSubmit}
        >
          {labels.submit}
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
                  <Text>{labels.escapeEnter}</Text>
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
          placeholder={labels.escapePlaceholder}
          value={escapeText}
          variant="filled"
          onChange={(e) => handleEscapeTextChange(e.target.value)}
        />
      ) : (
        activeQuestion && (
          <QuestionPanel
            answer={picks[activeQuestion.question]}
            customPlaceholder={labels.customPlaceholder}
            customValue={custom[activeQuestion.question] ?? ''}
            disabled={expired || submitting}
            multiSelectTag={labels.multiSelectTag}
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

AskUserQuestionView.displayName = 'AskUserQuestionView';

export default AskUserQuestionView;
