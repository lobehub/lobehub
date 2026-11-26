import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { registerPendingHotkeyCard } from '../pendingHotkeys';
import { resolveEscapeKey, stepQuestion } from './hotkeys';
import type { AskUserQuestionItem } from './types';
import type { AskUserFormApi } from './useAskUserForm';

const optionValue = (option: AskUserQuestionItem['options'][number]): string =>
  option.id ?? option.label;

/**
 * A focused interactive control keeps its native key activation — hijacking
 * Enter/Space away from a tabbed-to button or link would invert the keyboard
 * user's intent.
 */
const INTERACTIVE_SELECTOR =
  'a,button,select,summary,[role="button"],[role="tab"],[role="option"],[role="menuitem"],' +
  '[role="combobox"],[role="listbox"],[role="radio"],[role="slider"],[role="spinbutton"]';

interface UseAskUserHotkeysParams {
  actionsPortalTarget?: HTMLElement | null;
  canSkip: boolean;
  form: AskUserFormApi;
  rootRef: RefObject<HTMLDivElement | null>;
}

export const useAskUserHotkeys = ({
  actionsPortalTarget,
  canSkip,
  form,
  rootRef,
}: UseAskUserHotkeysParams) => {
  const { activeQuestion, custom, picks, questions } = form;
  const portalRef = useRef(actionsPortalTarget);

  // Keyed by question text so each question keeps its own cursor across tab
  // switches. `options.length` is a sentinel for the trailing free-text row.
  // Unset falls back to the picked option (single-select revisit) or row 1 —
  // so Enter alone accepts the first/recommended option, Codex-style.
  const [highlightMap, setHighlightMap] = useState<Record<string, number>>({});
  // The cursor is always tracked, but only drawn once the arrows are used:
  // an outline on load reads as a preselected answer.
  const [cursorVisible, setCursorVisible] = useState(false);

  const highlightedIndex = useMemo(() => {
    if (!activeQuestion) return undefined;
    const stored = highlightMap[activeQuestion.question];
    if (stored != null) return stored;
    if (!activeQuestion.multiSelect) {
      const picked = picks[activeQuestion.question];
      const idx = activeQuestion.options.findIndex((option) => optionValue(option) === picked);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [activeQuestion, highlightMap, picks]);

  const setHighlight = useCallback((q: AskUserQuestionItem, idx: number) => {
    setHighlightMap((m) => ({ ...m, [q.question]: idx }));
  }, []);

  const focusCustomInput = useCallback(() => {
    rootRef.current?.querySelector<HTMLTextAreaElement>('[role="listbox"] textarea')?.focus();
  }, [rootRef]);

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
          // The IME guard keeps Esc-canceling a CJK composition from acting.
          const typingInCard = rootRef.current?.contains(target) ?? false;
          if (!typingInCard || event.key !== 'Escape' || event.isComposing) return;
          event.preventDefault();
          target.blur();
          return;
        }
        if (target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
        if (event.key !== 'Escape' && target.closest(INTERACTIVE_SELECTOR)) return;
      }

      // Held-key auto-repeat must not chain picks across auto-advanced
      // questions or hammer Enter; arrows may repeat for fast scanning.
      if (event.repeat && !event.key.startsWith('Arrow')) return;

      const q = activeQuestion;
      const rowNavEnabled = !!q && !form.submitting && !form.expired && q.options.length > 0;

      if (/^[1-9]$/.test(event.key)) {
        if (!rowNavEnabled) return;
        const idx = Number(event.key) - 1;
        if (idx < q.options.length) {
          event.preventDefault();
          setHighlight(q, idx);
          form.handleToggle(q, optionValue(q.options[idx]), { submitOnComplete: true });
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
        setCursorVisible(true);
        const total = q.options.length + 1;
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        const next = ((highlightedIndex ?? 0) + delta + total) % total;
        setHighlight(q, next);
        if (next === q.options.length) focusCustomInput();
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (questions.length < 2 || !q) return;
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        form.setQuestionMode(String(stepQuestion(questions.indexOf(q), delta, questions.length)));
        return;
      }

      if (event.key === ' ') {
        if (!rowNavEnabled || highlightedIndex == null || highlightedIndex >= q.options.length)
          return;
        event.preventDefault();
        form.handleToggle(q, optionValue(q.options[highlightedIndex]));
        return;
      }

      if (event.key === 'Enter') {
        if (event.shiftKey) return;
        // Single-select with the cursor on a row that isn't the current pick:
        // Enter accepts that row. Otherwise Enter does what the primary
        // button says (Next, Submit or Send note only).
        if (
          rowNavEnabled &&
          !q.multiSelect &&
          highlightedIndex != null &&
          highlightedIndex < q.options.length &&
          !(custom[q.question] ?? '').trim() &&
          picks[q.question] !== optionValue(q.options[highlightedIndex])
        ) {
          event.preventDefault();
          form.handleToggle(q, optionValue(q.options[highlightedIndex]), {
            submitOnComplete: true,
          });
          return;
        }
        if (form.isSubmitDisabled) return;
        event.preventDefault();
        form.handlePrimary();
        return;
      }

      if (event.key === 'Escape') {
        const action = resolveEscapeKey({
          canSkip: canSkip && !form.submitting,
          hasDraft: form.hasDraft,
          typingInCard: false,
        });
        if (action !== 'skip') return;
        event.preventDefault();
        form.handleSkip();
      }
    };
  });

  // Registered once per mount: the shared arbiter dispatches each keypress to
  // exactly one pending card, so coexisting cards never race on a keystroke.
  useEffect(
    () =>
      registerPendingHotkeyCard({
        contains: (node) =>
          Boolean(rootRef.current?.contains(node)) || Boolean(portalRef.current?.contains(node)),
        onKeyDown: (event) => onKeyDownRef.current(event),
      }),
    [rootRef],
  );

  const handleCustomNavigate = useCallback(
    (direction: 'next' | 'prev') => {
      if (!activeQuestion) return;
      setHighlight(activeQuestion, direction === 'prev' ? activeQuestion.options.length - 1 : 0);
    },
    [activeQuestion, setHighlight],
  );

  return {
    handleCustomNavigate,
    highlightedIndex: cursorVisible ? highlightedIndex : undefined,
  };
};
