'use client';

import { Flexbox, Icon, Tabs, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { AskUserFooterLabels } from './AskUserFooter';
import AskUserFooter from './AskUserFooter';
import { formatRemaining, isQuestionAnswered } from './draft';
import QuestionPanel from './QuestionPanel';
import type { AskUserFormApi } from './useAskUserForm';
import { useAskUserHotkeys } from './useAskUserHotkeys';

const styles = stylex.create({
  note: {
    gap: '6px',
    paddingBlockStart: '12px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: cssVar.colorFillSecondary,
  },
  progress: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineEnd: '4px',
    transform: 'translateY(-50%)',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    pointerEvents: 'none',
  },
  tabLabel: {
    overflow: 'hidden',
    maxWidth: '160px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabList: { width: '100%' },
  tabs: { position: 'relative' },
});

/**
 * All display strings the view needs. Kept i18n-free so `shared-tool-ui` stays
 * app-decoupled — each host builds this from its own namespace.
 */
export interface AskUserQuestionLabels extends AskUserFooterLabels {
  customPlaceholder: string;
  noteLabel: string;
  progress: (answered: number, total: number) => string;
  /** Badge text for options carrying the "(Recommended)" label marker. */
  recommendedTag: string;
  supplementPlaceholder: string;
  /** Shown once the timeout fallback has answered on the user's behalf. */
  timeExpired: string;
  /**
   * Shown when the clock ran out with no fallback answer — provider-owned
   * option ids (consent is never inferred) or a card opened after the
   * producer already stopped waiting.
   */
  timeExpiredNoAnswer: string;
  timeRemaining: (time: string) => string;
}

const countdownLabel = (
  labels: AskUserQuestionLabels,
  {
    autoSubmitted,
    expired,
    remainingMs,
  }: Pick<AskUserFormApi, 'autoSubmitted' | 'expired' | 'remainingMs'>,
) => {
  if (autoSubmitted) return labels.timeExpired;
  if (expired) return labels.timeExpiredNoAnswer;
  return labels.timeRemaining(formatRemaining(remainingMs));
};

export interface AskUserQuestionViewProps extends AskUserFormApi {
  /** Portal the footer here so it stays pinned below the scroll. */
  actionsPortalTarget?: HTMLElement | null;
  labels: AskUserQuestionLabels;
  /** Render the countdown text in the footer (only when a countdown is active). */
  showCountdown: boolean;
}

export const AskUserQuestionView = memo<AskUserQuestionViewProps>((props) => {
  const {
    actionsPortalTarget,
    activeQuestion,
    activeTab,
    answeredCount,
    autoSubmitted,
    custom,
    expired,
    handleCustomChange,
    handlePrimary,
    handleRemoveNote,
    handleSkip,
    handleSupplementTextChange,
    handleToggle,
    hasDraft,
    isSubmitDisabled,
    labels,
    picks,
    primary,
    questions,
    remainingMs,
    setQuestionMode,
    setSupplementMode,
    showCountdown,
    submitting,
    supplementActive,
    supplementText,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const { handleCustomNavigate, highlightedIndex } = useAskUserHotkeys({
    actionsPortalTarget,
    canSkip: !!labels.skip,
    form: props,
    rootRef,
  });

  const handleAddNote = useCallback(() => {
    setSupplementMode(true);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLTextAreaElement>('[data-ask-note] textarea')?.focus(),
    );
  }, [setSupplementMode]);

  const countdownText = showCountdown
    ? countdownLabel(labels, { autoSubmitted, expired, remainingMs })
    : undefined;

  const footer = (
    <AskUserFooter
      countdownText={countdownText}
      hasDraft={hasDraft}
      labels={labels}
      noteOpen={supplementActive}
      primary={primary}
      primaryDisabled={isSubmitDisabled}
      questions={questions}
      submitting={submitting}
      onAddNote={handleAddNote}
      onPrimary={handlePrimary}
      onRemoveNote={handleRemoveNote}
      onSkip={handleSkip}
    />
  );

  return (
    <Flexbox gap={12} ref={rootRef}>
      {questions.length > 1 && (
        <div {...stylex.props(styles.tabs)}>
          <Tabs
            activeKey={activeTab}
            classNames={{ list: stylex.props(styles.tabList).className }}
            variant="square"
            items={questions.map((q, idx) => ({
              key: String(idx),
              label: (
                <Flexbox horizontal align="center" gap={6}>
                  <Text className={stylex.props(styles.tabLabel).className}>
                    {q.header || `Q${idx + 1}`}
                  </Text>
                  {isQuestionAnswered(q, picks, custom) && <Icon icon={Check} size={12} />}
                </Flexbox>
              ),
            }))}
            onChange={(key: string) => setQuestionMode(key)}
          />
          <span {...stylex.props(styles.progress)}>
            {labels.progress(answeredCount, questions.length)}
          </span>
        </div>
      )}

      {activeQuestion && (
        <QuestionPanel
          answer={picks[activeQuestion.question]}
          customPlaceholder={labels.customPlaceholder}
          customValue={custom[activeQuestion.question] ?? ''}
          disabled={expired || submitting}
          highlightedIndex={highlightedIndex}
          question={activeQuestion}
          recommendedTag={labels.recommendedTag}
          onCustomChange={handleCustomChange}
          onCustomNavigate={handleCustomNavigate}
          onPressEnter={isSubmitDisabled ? undefined : handlePrimary}
          onToggle={handleToggle}
        />
      )}

      {supplementActive && (
        <Flexbox data-ask-note className={stylex.props(styles.note).className}>
          <Text fontSize={12} type="secondary">
            {labels.noteLabel}
          </Text>
          <TextArea
            autoSize={{ maxRows: 8, minRows: 2 }}
            disabled={expired || submitting}
            placeholder={labels.supplementPlaceholder}
            value={supplementText}
            variant="filled"
            onChange={(e) => handleSupplementTextChange(e.target.value)}
            onKeyDown={(e) => {
              // The IME guard keeps CJK composition confirms from submitting.
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              if (e.metaKey || e.ctrlKey || e.altKey) return;
              if (isSubmitDisabled) return;
              e.preventDefault();
              handlePrimary();
            }}
          />
        </Flexbox>
      )}

      {actionsPortalTarget ? createPortal(footer, actionsPortalTarget) : footer}
    </Flexbox>
  );
});

AskUserQuestionView.displayName = 'AskUserQuestionView';

export default AskUserQuestionView;
