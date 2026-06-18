import type { BuiltinInterventionProps } from '@lobechat/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../../types';
import type { AskUserDraft } from './draft';
import {
  buildSubmitPayload,
  COUNTDOWN_MS,
  DRAFT_PLUGIN_STATE_KEY,
  FREEFORM_PAYLOAD_KEY,
  isQuestionAnswered,
  readDraft,
} from './draft';

/**
 * All state + handlers for the CC AskUserQuestion form. Kept out of the view
 * so `index.tsx` stays a thin render of the returned values.
 *
 * Draft persistence: every mutation mirrors the full form state into the tool
 * message's `pluginState.askUserDraft` (see `setInterventionDraft`) so HMR,
 * remounts, and tab switches resume where the user left off.
 */
export const useAskUserForm = ({
  args,
  messageId,
  onInteractionAction,
}: BuiltinInterventionProps<AskUserQuestionArgs>) => {
  const questions = args?.questions ?? [];

  // Persisted draft — read from the tool message's pluginState so the form
  // stays where the user left it across unmount / HMR / refresh.
  const persistedDraft = useConversationStore((s) => {
    const msg = dataSelectors.getDbMessageById(messageId)(s);
    return (msg?.pluginState as { [DRAFT_PLUGIN_STATE_KEY]?: unknown })?.[DRAFT_PLUGIN_STATE_KEY];
  });
  const setInterventionDraft = useChatStore((s) => s.setInterventionDraft);

  // Plain const (not a hook) so it can read `persistedDraft` without tripping
  // exhaustive-deps; consumed only by the once-run useState initializers below.
  const initial = readDraft(persistedDraft);

  const [picks, setPicks] = useState<Record<string, string | string[]>>(() => initial.picks);
  const [custom, setCustom] = useState<Record<string, string>>(() => initial.custom);
  const [escapeText, setEscapeText] = useState<string>(() => initial.escapeText);
  const [escapeActive, setEscapeActive] = useState<boolean>(() => initial.escapeActive);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Resume on the first unanswered question rather than always at Q1.
    const idx = questions.findIndex((q) => !isQuestionAnswered(q, initial.picks, initial.custom));
    return String(idx >= 0 ? idx : 0);
  });

  // Mounted-time deadline; server has its own clock and will return isError if
  // it expires first. Drift of a few seconds is fine.
  const deadline = useMemo(() => Date.now() + COUNTDOWN_MS, []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const expired = now >= deadline;

  const writeDraft = useCallback(
    (next: AskUserDraft) => setInterventionDraft(messageId, next),
    [messageId, setInterventionDraft],
  );

  const handleToggle = useCallback(
    (q: AskUserQuestionItem, label: string) => {
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
      writeDraft({ custom: nextCustom, escapeActive, escapeText, picks: nextPicks });

      // Single-select auto-advance to the next still-unanswered question, so
      // the user sweeps through without re-clicking the tabs.
      if (!q.multiSelect && questions.length > 1) {
        const next = questions.findIndex(
          (qq) => qq.question !== q.question && !isQuestionAnswered(qq, nextPicks, nextCustom),
        );
        if (next >= 0) setActiveTab(String(next));
      }
    },
    [picks, custom, escapeActive, escapeText, questions, writeDraft],
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
      writeDraft({ custom: nextCustom, escapeActive, escapeText, picks: nextPicks });
    },
    [picks, custom, escapeActive, escapeText, writeDraft],
  );

  /**
   * Submit `payload` exactly as given. Used by the Submit button (with the
   * user's picks/text) and the timeout fallback (option 1 of each unanswered
   * question merged in).
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

  const handleEscapeTextChange = useCallback(
    (value: string) => {
      setEscapeText(value);
      // Persist freeform text alongside the (hidden) picks so a refresh resumes
      // here; the picks survive a toggle back to the form.
      writeDraft({ custom, escapeActive: true, escapeText: value, picks });
    },
    [custom, picks, writeDraft],
  );

  const handleEscapeToggle = useCallback(() => {
    setEscapeActive((prev) => {
      const next = !prev;
      writeDraft({ custom, escapeActive: next, escapeText, picks });
      return next;
    });
  }, [custom, escapeText, picks, writeDraft]);

  const handleSubmit = useCallback(() => {
    if (escapeActive) {
      // Escape mode is mutually exclusive with picks — send the text alone
      // under `__freeform__`. Bridge formatter forwards it to CC verbatim.
      void submitWith({ [FREEFORM_PAYLOAD_KEY]: escapeText.trim() });
    } else {
      void submitWith(buildSubmitPayload(questions, picks, custom));
    }
  }, [custom, escapeActive, escapeText, picks, questions, submitWith]);

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
    if (escapeActive && escapeText.trim().length > 0) {
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
    void submitWith(fallback);
  }, [expired, submitting, questions, escapeActive, escapeText, picks, custom, submitWith]);

  const activeQuestion = questions[Number(activeTab)] ?? questions[0];
  const isSubmitDisabled = escapeActive
    ? !escapeText.trim() || submitting || expired
    : !allAnswered || expired || submitting;

  return {
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
    isMulti: questions.length > 1,
    isSubmitDisabled,
    picks,
    questions,
    remainingMs: deadline - now,
    setActiveTab,
    submitting,
  };
};
