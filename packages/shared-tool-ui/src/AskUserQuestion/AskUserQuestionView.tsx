'use client';

import { Flexbox, Hotkey, Icon, KeyMapEnum, Text, TextArea } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Check, PenLine, Send, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { registerPendingHotkeyCard } from '../pendingHotkeys';
import { formatRemaining, isQuestionAnswered } from './draft';
import QuestionPanel from './QuestionPanel';
import type { AskUserQuestionItem } from './types';
import type { AskUserFormApi } from './useAskUserForm';

/**
 * A focused interactive control keeps its native key activation — hijacking
 * Enter/Space away from a tabbed-to button or link would invert the keyboard
 * user's intent.
 */
const INTERACTIVE_SELECTOR =
  'a,button,select,summary,[role="button"],[role="tab"],[role="option"],[role="menuitem"],' +
  '[role="combobox"],[role="listbox"],[role="radio"],[role="slider"],[role="spinbutton"]';

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
  /** Badge text for options carrying the "(Recommended)" label marker. */
  recommendedTag: string;
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
 * All form state and handlers arrive via props (from `useAskUserForm`); the
 * only local state is the keyboard cursor. Its one side effect is the
 * window-level shortcut listener (digits / arrows / Space / Enter / Esc).
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

  // Keyboard cursor over the active question's rows, keyed by question text so
  // each question keeps its own cursor across tab switches with no reset
  // effect. `options.length` is a sentinel for the trailing free-text row.
  // Unset falls back to the picked option (single-select revisit) or row 1 —
  // so Enter alone accepts the first/recommended option, Codex-style.
  const [highlightMap, setHighlightMap] = useState<Record<string, number>>({});
  const highlightedIndex = useMemo(() => {
    if (!activeQuestion) return undefined;
    const stored = highlightMap[activeQuestion.question];
    if (stored != null) return stored;
    if (!activeQuestion.multiSelect) {
      const picked = picks[activeQuestion.question];
      const idx = activeQuestion.options.findIndex((o) => o.label === picked);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [activeQuestion, highlightMap, picks]);

  const setHighlight = useCallback((q: AskUserQuestionItem, idx: number) => {
    setHighlightMap((m) => ({ ...m, [q.question]: idx }));
  }, []);

  // The active panel renders exactly one textarea (the per-question free-text
  // row; the whole-form escape textarea replaces it and disables row
  // navigation), so a DOM query is enough — no ref plumbing through the panel.
  const focusCustomInput = useCallback(() => {
    rootRef.current?.querySelector('textarea')?.focus();
  }, []);

  // Page-level keyboard: 1-9 pick the numbered row, ↑/↓ move the cursor (the
  // row after the last option focuses the free-text box), Space toggles the
  // highlighted row, Enter picks (single-select, unanswered) or submits, Esc
  // skips. The card is the pending interaction, so the shortcuts work without
  // focusing it first. Backs off while the user is typing anywhere outside the
  // card (chat composer included; the card's own textareas handle their keys
  // via onKeyDown while Esc keeps skipping there), when the event was already
  // consumed (e.g. an overlay closing itself on Esc), or inside open overlays
  // so Esc keeps meaning "close this overlay" there.
  //
  // Read through a ref so the arbiter registration below stays mount-stable
  // while the handler always sees fresh state; the effect re-runs every render
  // instead of tracking a dependency list.
  const onKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    portalRef.current = actionsPortalTarget;
    onKeyDownRef.current = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          // Typing inside this card only backs off non-Esc keys (handled by the
          // textarea itself) — the advertised Esc-to-skip must keep working.
          // The IME guard keeps Esc-canceling a CJK composition from skipping.
          const typingInCard = rootRef.current?.contains(target) ?? false;
          if (!typingInCard || event.key !== 'Escape' || event.isComposing) return;
        }
        if (target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
        // A focused interactive control (a select, a radio group, a tabbed-to
        // button…) keeps its native keys — digits/arrows/Space/Enter all
        // yield; only the advertised Esc-to-skip stays. Our own option rows
        // are non-focusable divs, so they never appear as the keydown target.
        if (event.key !== 'Escape' && target.closest(INTERACTIVE_SELECTOR)) return;
      }

      // Held-key auto-repeat must not chain picks across auto-advanced
      // questions (a held digit could answer-and-submit the whole form) or
      // hammer Enter; arrows may repeat for fast row scanning.
      if (event.repeat && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

      const q = activeQuestion;
      const rowNavEnabled = !!q && !escapeActive && !submitting && !expired && q.options.length > 0;

      // Digit keys pick the matching numbered row directly; the row after the
      // last option is the "write your own" line, which focuses its textarea.
      if (/^[1-9]$/.test(event.key)) {
        if (!rowNavEnabled) return;
        const idx = Number(event.key) - 1;
        if (idx < q.options.length) {
          event.preventDefault();
          setHighlight(q, idx);
          handleToggle(q, q.options[idx].label, { submitOnComplete: true });
        } else if (idx === q.options.length) {
          event.preventDefault();
          setHighlight(q, q.options.length);
          focusCustomInput();
        }
        return;
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!rowNavEnabled) return;
        event.preventDefault();
        const total = q.options.length + 1; // +1: the free-text row
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        const next = ((highlightedIndex ?? 0) + delta + total) % total;
        setHighlight(q, next);
        if (next === q.options.length) focusCustomInput();
        return;
      }

      if (event.key === ' ') {
        if (!rowNavEnabled || highlightedIndex == null || highlightedIndex >= q.options.length)
          return;
        event.preventDefault();
        handleToggle(q, q.options[highlightedIndex].label);
        return;
      }

      if (event.key === 'Enter') {
        if (event.shiftKey) return;
        // Single-select with the cursor on a row that isn't the current pick:
        // Enter accepts that row (which may select-to-submit via the form
        // hook) — including when revisiting an already-answered question to
        // change the answer. With the cursor on the picked row, on a
        // custom-text answer, or on a multi-select (Space/digits toggle
        // there), Enter keeps meaning "submit the form".
        if (
          rowNavEnabled &&
          !q.multiSelect &&
          highlightedIndex != null &&
          highlightedIndex < q.options.length &&
          !(custom[q.question] ?? '').trim() &&
          picks[q.question] !== q.options[highlightedIndex].label
        ) {
          event.preventDefault();
          handleToggle(q, q.options[highlightedIndex].label, { submitOnComplete: true });
          return;
        }
        if (isSubmitDisabled) return;
        event.preventDefault();
        handleSubmit();
      } else if (event.key === 'Escape') {
        if (submitting) return;
        event.preventDefault();
        handleSkip();
      }
    };
  });

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
            highlightedIndex={highlightedIndex}
            multiSelectTag={labels.multiSelectTag}
            question={activeQuestion}
            recommendedTag={labels.recommendedTag}
            onCustomChange={handleCustomChange}
            onPressEnter={isSubmitDisabled ? undefined : handleSubmit}
            onToggle={handleToggle}
            onCustomNavigate={(direction) =>
              setHighlight(
                activeQuestion,
                direction === 'prev' ? activeQuestion.options.length - 1 : 0,
              )
            }
          />
        )
      )}

      {actionsPortalTarget ? createPortal(footer, actionsPortalTarget) : footer}
    </Flexbox>
  );
});

AskUserQuestionView.displayName = 'AskUserQuestionView';

export default AskUserQuestionView;
