import type { BuiltinInterventionProps } from '@lobechat/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildSubmitPayload,
  FREEFORM_PAYLOAD_KEY,
  isQuestionAnswered,
  readDraft,
  SUPPLEMENT_PAYLOAD_KEY,
} from './draft';
import { normalizeAskUserQuestions } from './normalize';
import type { AskUserDraft, AskUserQuestionArgs, AskUserQuestionItem } from './types';

export interface UseAskUserFormParams {
  args: AskUserQuestionArgs | undefined;
  /**
   * When set, drives an on-screen countdown + a timeout fallback that submits
   * option 1 of every unanswered question when the clock hits zero. When
   * `undefined` the countdown + fallback are disabled entirely (`expired` stays
   * `false`, no timer runs) — used by surfaces with no bridge timeout.
   */
  countdownMs?: number;
  onInteractionAction?: BuiltinInterventionProps<AskUserQuestionArgs>['onInteractionAction'];
  /** Raw persisted draft blob read from the host's store (coerced internally). */
  persistedDraft: unknown;
  /** Persist the full draft; host wires this to its own store. */
  writeDraft: (draft: AskUserDraft) => void;
}

export interface AskUserFormApi {
  activeQuestion?: AskUserQuestionItem;
  activeTab: string;
  custom: Record<string, string>;
  escapeActive: boolean;
  escapeText: string;
  expired: boolean;
  handleCustomChange: (q: AskUserQuestionItem, value: string) => void;
  handleEscapeTextChange: (value: string) => void;
  handleSkip: () => void;
  handleSubmit: () => void;
  handleSupplementTextChange: (value: string) => void;
  handleToggle: (
    q: AskUserQuestionItem,
    label: string,
    options?: {
      /**
       * Allow the single-select "select-to-submit" fast path for this toggle.
       * Only keyboard-driven picks (digits / Enter) opt in — a mouse click is
       * too easy to land by accident to fire a submit on its own, so clicks
       * just select and leave submission to the explicit Submit button/Enter.
       */
      submitOnComplete?: boolean;
    },
  ) => void;
  isMulti: boolean;
  isSubmitDisabled: boolean;
  picks: Record<string, string | string[]>;
  questions: AskUserQuestionItem[];
  remainingMs: number;
  setEscapeMode: (next: boolean) => void;
  setQuestionMode: (key: string) => void;
  setSupplementMode: (next: boolean) => void;
  submitting: boolean;
  supplementActive: boolean;
  supplementText: string;
}

/**
 * All state + handlers for the AskUserQuestion form. Kept out of the view so
 * the per-package `index.tsx` stays a thin render of the returned values.
 *
 * Draft persistence is host-owned: the caller passes the raw `persistedDraft`
 * (read from wherever it stores plugin state) and a `writeDraft` callback, so
 * this hook never touches any app store directly and stays app-decoupled.
 */
export const useAskUserForm = ({
  args,
  countdownMs,
  onInteractionAction,
  persistedDraft,
  writeDraft,
}: UseAskUserFormParams): AskUserFormApi => {
  const questions = useMemo(() => normalizeAskUserQuestions(args), [args]);

  // Plain const (not a hook) so it can read `persistedDraft` without tripping
  // exhaustive-deps; consumed only by the once-run useState initializers below.
  const initial = readDraft(persistedDraft);

  const [picks, setPicks] = useState<Record<string, string | string[]>>(() => initial.picks);
  const [custom, setCustom] = useState<Record<string, string>>(() => initial.custom);
  const [escapeText, setEscapeText] = useState<string>(() => initial.escapeText);
  const [escapeActive, setEscapeActive] = useState<boolean>(() => initial.escapeActive);
  const [supplementText, setSupplementText] = useState<string>(() => initial.supplementText);
  const [supplementActive, setSupplementActive] = useState<boolean>(
    () => initial.supplementActive && !initial.escapeActive,
  );
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Resume on the first unanswered question rather than always at Q1.
    const idx = questions.findIndex((q) => !isQuestionAnswered(q, initial.picks, initial.custom));
    return String(idx >= 0 ? idx : 0);
  });

  // Countdown is opt-in: only surfaces with a bridge timeout pass `countdownMs`.
  const countdownEnabled = countdownMs != null;

  // Mounted-time deadline; server has its own clock and will return isError if
  // it expires first. Drift of a few seconds is fine.
  const deadline = useMemo(() => Date.now() + (countdownMs ?? 0), [countdownMs]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!countdownEnabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [countdownEnabled]);
  const expired = countdownEnabled ? now >= deadline : false;

  /**
   * Submit `payload` exactly as given. Used by the Submit button (with the
   * user's picks/text), the single-select select-to-submit path, and the
   * timeout fallback (option 1 of each unanswered question merged in).
   */
  const submitWith = useCallback(
    async (payload: Record<string, string | string[]>) => {
      if (!onInteractionAction || submitting) return;
      setSubmitting(true);
      try {
        await onInteractionAction({ payload, type: 'submit' });
      } catch (err) {
        console.error('[AskUserQuestion] submit failed:', err);
        setSubmitting(false);
      }
    },
    [onInteractionAction, submitting],
  );

  const handleToggle = useCallback(
    (q: AskUserQuestionItem, label: string, options?: { submitOnComplete?: boolean }) => {
      let nextPicks: Record<string, string | string[]>;
      if (q.multiSelect) {
        const current = (picks[q.question] as string[] | undefined) ?? [];
        nextPicks = {
          ...picks,
          [q.question]: current.includes(label)
            ? current.filter((x) => x !== label)
            : [...current, label],
        };
      } else {
        nextPicks = { ...picks, [q.question]: label };
      }

      // Single-select pick and custom text are mutually exclusive — picking
      // drops any "write your own" text. Multi-select keeps it (additive).
      let nextCustom = custom;
      if (!q.multiSelect && custom[q.question]) {
        const { [q.question]: _drop, ...rest } = custom;
        nextCustom = rest;
      }

      setPicks(nextPicks);
      if (nextCustom !== custom) setCustom(nextCustom);
      writeDraft({
        custom: nextCustom,
        escapeActive,
        escapeText,
        picks: nextPicks,
        supplementActive,
        supplementText,
      });

      if (!q.multiSelect) {
        // Codex-style select-to-submit: the pick that completes the form sends
        // it right away — no extra Submit press for single-select flows. Two
        // gates: the caller must opt in via `submitOnComplete` (keyboard picks
        // only — a stray mouse click must never submit on its own), and the
        // question must have been unanswered so revisiting an already answered
        // question only updates the pick and never fires a surprise submit
        // while the user is reviewing.
        const wasUnanswered = !isQuestionAnswered(q, picks, custom);
        const allAnswered = questions.every((qq) => isQuestionAnswered(qq, nextPicks, nextCustom));
        if (options?.submitOnComplete && wasUnanswered && allAnswered) {
          const payload = buildSubmitPayload(questions, nextPicks, nextCustom);
          if (supplementText.trim()) {
            payload[SUPPLEMENT_PAYLOAD_KEY] = supplementText.trim();
          }
          void submitWith(payload);
          return;
        }

        // Auto-advance to the next still-unanswered question, so the user
        // sweeps through without re-clicking the tabs.
        if (questions.length > 1) {
          const next = questions.findIndex(
            (qq) => qq.question !== q.question && !isQuestionAnswered(qq, nextPicks, nextCustom),
          );
          if (next >= 0) setActiveTab(String(next));
        }
      }
    },
    [
      picks,
      custom,
      escapeActive,
      escapeText,
      questions,
      submitWith,
      supplementActive,
      supplementText,
      writeDraft,
    ],
  );

  const handleCustomChange = useCallback(
    (q: AskUserQuestionItem, value: string) => {
      const nextCustom = { ...custom, [q.question]: value };

      // Single-select: writing your own answer clears the picked option so the
      // two stay mutually exclusive. Multi-select keeps the checks — custom
      // text rides along as an additive entry.
      let nextPicks = picks;
      if (!q.multiSelect && value.trim() && picks[q.question]) {
        const { [q.question]: _drop, ...rest } = picks;
        nextPicks = rest;
      }

      setCustom(nextCustom);
      if (nextPicks !== picks) setPicks(nextPicks);
      writeDraft({
        custom: nextCustom,
        escapeActive,
        escapeText,
        picks: nextPicks,
        supplementActive,
        supplementText,
      });
    },
    [picks, custom, escapeActive, escapeText, supplementActive, supplementText, writeDraft],
  );

  const handleEscapeTextChange = useCallback(
    (value: string) => {
      setEscapeText(value);
      // Persist freeform text alongside the (hidden) picks so a refresh resumes
      // here; the picks survive a toggle back to the form.
      writeDraft({
        custom,
        escapeActive: true,
        escapeText: value,
        picks,
        supplementActive: false,
        supplementText,
      });
    },
    [custom, picks, supplementText, writeDraft],
  );

  const handleSupplementTextChange = useCallback(
    (value: string) => {
      setSupplementText(value);
      writeDraft({
        custom,
        escapeActive: false,
        escapeText,
        picks,
        supplementActive: true,
        supplementText: value,
      });
    },
    [custom, escapeText, picks, writeDraft],
  );

  const setEscapeMode = useCallback(
    (next: boolean) => {
      setEscapeActive(next);
      if (next) setSupplementActive(false);
      writeDraft({
        custom,
        escapeActive: next,
        escapeText,
        picks,
        supplementActive: next ? false : supplementActive,
        supplementText,
      });
    },
    [custom, escapeText, picks, supplementActive, supplementText, writeDraft],
  );

  const setSupplementMode = useCallback(
    (next: boolean) => {
      setSupplementActive(next);
      if (next) setEscapeActive(false);
      writeDraft({
        custom,
        escapeActive: next ? false : escapeActive,
        escapeText,
        picks,
        supplementActive: next,
        supplementText,
      });
    },
    [custom, escapeActive, escapeText, picks, supplementText, writeDraft],
  );

  // Returning to a question clears both whole-form modes and persists one
  // coherent snapshot. Calling the two mode setters back-to-back would let the
  // second stale closure restore the mode the first setter just cleared.
  const setQuestionMode = useCallback(
    (key: string) => {
      setActiveTab(key);
      setEscapeActive(false);
      setSupplementActive(false);
      writeDraft({
        custom,
        escapeActive: false,
        escapeText,
        picks,
        supplementActive: false,
        supplementText,
      });
    },
    [custom, escapeText, picks, supplementText, writeDraft],
  );

  // Whole-form freeform only makes sense with more than one question — with a
  // single question the per-question custom box already IS the full custom
  // answer, so escape is redundant there and never offered.
  const escapeAvailable = questions.length > 1;
  const supplementAvailable = questions.length > 0;
  const inEscape = escapeActive && escapeAvailable;
  const inSupplement = supplementActive && supplementAvailable;

  const handleSubmit = useCallback(() => {
    if (escapeActive && escapeAvailable) {
      // Escape mode is mutually exclusive with picks — send the text alone
      // under `__freeform__`. Bridge formatter forwards it verbatim.
      void submitWith({ [FREEFORM_PAYLOAD_KEY]: escapeText.trim() });
    } else {
      const payload = buildSubmitPayload(questions, picks, custom);
      // Additional notes are a saved form value, not a tab-local value. Once
      // entered, keep them on an explicit submit even after the user returns
      // to a question to review or change an answer. Replace-all remains the
      // only mutually exclusive submission mode.
      if (supplementText.trim()) payload[SUPPLEMENT_PAYLOAD_KEY] = supplementText.trim();
      void submitWith(payload);
    }
  }, [
    custom,
    escapeActive,
    escapeAvailable,
    escapeText,
    inSupplement,
    picks,
    questions,
    submitWith,
    supplementText,
  ]);

  const handleSkip = useCallback(async () => {
    if (!onInteractionAction || submitting) return;
    setSubmitting(true);
    try {
      await onInteractionAction({ type: 'skip' });
    } catch (err) {
      console.error('[AskUserQuestion] skip failed:', err);
      setSubmitting(false);
    }
  }, [onInteractionAction, submitting]);

  const allAnswered = useMemo(
    () => questions.every((q) => isQuestionAnswered(q, picks, custom)),
    [picks, custom, questions],
  );

  // Timeout fallback: when the countdown hits zero and the user hasn't
  // submitted, fill option 1 of each unanswered question and submit. Beats
  // letting the bridge time out into a `cancelled` isError — the model gets a
  // structured answer it can act on. Single-shot via the `submitting` guard.
  //
  // Escape-mode special case: if the user is in escape mode with non-empty text
  // when the clock hits zero, submit that text as-is rather than discarding it.
  useEffect(() => {
    if (!expired || submitting || questions.length === 0) return;
    if (escapeActive && escapeAvailable && escapeText.trim().length > 0) {
      void submitWith({ [FREEFORM_PAYLOAD_KEY]: escapeText.trim() });
      return;
    }
    // Start from whatever the user picked / typed, then backfill option 1 for
    // any question still untouched.
    const fallback = buildSubmitPayload(questions, picks, custom);
    for (const q of questions) {
      if (fallback[q.question] == null && q.options.length > 0) {
        const first = q.options[0].label;
        fallback[q.question] = q.multiSelect ? [first] : first;
      }
    }
    // Match explicit submission: leaving the notes tab only changes which
    // editor is visible; it does not discard the saved notes.
    if (supplementText.trim()) {
      fallback[SUPPLEMENT_PAYLOAD_KEY] = supplementText.trim();
    }
    void submitWith(fallback);
  }, [
    expired,
    submitting,
    questions,
    escapeActive,
    escapeAvailable,
    escapeText,
    picks,
    custom,
    supplementText,
    submitWith,
  ]);

  const activeQuestion = questions[Number(activeTab)] ?? questions[0];
  const isSubmitDisabled =
    questions.length === 0 ||
    (inEscape
      ? !escapeText.trim() || submitting || expired
      : inSupplement
        ? !allAnswered || !supplementText.trim() || submitting || expired
        : !allAnswered || expired || submitting);

  return {
    activeQuestion,
    activeTab,
    custom,
    escapeActive: inEscape,
    escapeText,
    expired,
    handleCustomChange,
    handleEscapeTextChange,
    handleSkip,
    handleSubmit,
    handleSupplementTextChange,
    handleToggle,
    isMulti: escapeAvailable,
    isSubmitDisabled,
    picks,
    questions,
    remainingMs: deadline - now,
    setEscapeMode,
    setQuestionMode,
    setSupplementMode,
    submitting,
    supplementActive: inSupplement,
    supplementText,
  };
};
