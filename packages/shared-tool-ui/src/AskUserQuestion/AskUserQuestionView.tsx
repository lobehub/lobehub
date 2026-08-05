'use client';

import { Flexbox, Hotkey, Icon, KeyMapEnum, Text, TextArea } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Check, PenLine, Send, X } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { registerPendingHotkeyCard } from '../pendingHotkeys';
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
 * component holds no state of its own — its only side effect is the
 * window-level Enter-to-submit / Esc-to-skip shortcut listener.
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

  const rootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef(actionsPortalTarget);

  // Page-level keyboard: Enter submits, Esc skips — the card is the pending
  // interaction, so the shortcuts work without focusing it first. Backs off
  // while the user is typing anywhere outside the card (chat composer
  // included; the card's own textareas handle Enter via their onKeyDown while
  // Esc keeps skipping there), when the event was already consumed (e.g. an
  // overlay closing itself on Esc), or inside open overlays so Esc keeps
  // meaning "close this overlay" there.
  //
  // Read through a ref so the arbiter registration below stays mount-stable
  // while the handler always sees fresh state.
  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    portalRef.current = actionsPortalTarget;
    onKeyDownRef.current = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          // Typing inside this card only backs off Enter (handled by the
          // textarea itself) — the advertised Esc-to-skip must keep working.
          // The IME guard keeps Esc-canceling a CJK composition from skipping.
          const typingInCard = rootRef.current?.contains(target) ?? false;
          if (!typingInCard || event.key !== 'Escape' || event.isComposing) return;
        }
        if (target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
      }
      if (event.key === 'Enter') {
        if (event.shiftKey || isSubmitDisabled) return;
        // A focused interactive control (e.g. tabbing to the Skip button, a
        // tab, or a link) keeps its native Enter activation — hijacking it
        // into submit would invert the keyboard user's intent.
        if (
          target?.closest(
            'a,button,select,summary,[role="button"],[role="tab"],[role="option"],[role="menuitem"]',
          )
        )
          return;
        event.preventDefault();
        handleSubmit();
      } else if (event.key === 'Escape') {
        if (submitting) return;
        event.preventDefault();
        handleSkip();
      }
    };
  }, [actionsPortalTarget, handleSubmit, handleSkip, isSubmitDisabled, submitting]);

  // Registered once per mount: the shared arbiter dispatches each keypress to
  // exactly one pending card (containment first, then newest registration), so
  // coexisting cards — this one, the global notification's, a tool-approval
  // card — never race on the same keystroke, regardless of re-render timing.
  useEffect(
    () =>
      registerPendingHotkeyCard({
        contains: (node) =>
          Boolean(rootRef.current?.contains(node)) || Boolean(portalRef.current?.contains(node)),
        onKeyDown: (event) => onKeyDownRef.current(event),
      }),
    [],
  );

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
          <Hotkey compact keys={KeyMapEnum.Esc} variant="borderless" />
        </Button>
        <Button
          disabled={isSubmitDisabled}
          icon={<Icon icon={Send} />}
          loading={submitting}
          type="primary"
          onClick={handleSubmit}
        >
          {labels.submit}
          <Hotkey compact inverseTheme keys={KeyMapEnum.Enter} variant="borderless" />
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Flexbox gap={12} ref={rootRef}>
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
          onKeyDown={(e) => {
            // Enter submits (Shift+Enter keeps inserting a newline); fall back
            // to the default newline while submit is unavailable. The IME guard
            // keeps CJK composition confirms from submitting the form.
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (isSubmitDisabled) return;
            e.preventDefault();
            handleSubmit();
          }}
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
            onPressEnter={isSubmitDisabled ? undefined : handleSubmit}
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
