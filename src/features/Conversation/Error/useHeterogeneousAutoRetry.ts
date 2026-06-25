import { useCallback, useEffect, useRef, useState } from 'react';

import { useConversationStore } from '../store';
import {
  HETERO_OVERLOAD_BACKOFF_JITTER,
  HETERO_OVERLOAD_BACKOFF_SECONDS,
  MAX_HETERO_AUTO_RETRIES,
} from '../store/slices/generation/heteroRetryConfig';

/**
 * View-model the overloaded guide renders while an auto-retry is pending. When
 * the hook returns `undefined` the guide falls back to its static manual-retry
 * card (auto-retry disabled, no scope, or the budget is exhausted/cancelled).
 */
export interface HeteroAutoRetryViewModel {
  /** 1-based index of the attempt about to run (e.g. "2 / 5"). */
  attempt: number;
  maxAttempts: number;
  /** Stop auto-retrying and fall back to the manual card. */
  onCancel: () => void;
  /** Skip the remaining wait and retry right now. */
  onRetryNow: () => void;
  /** Whole seconds left before the scheduled retry fires. */
  secondsLeft: number;
}

interface UseHeterogeneousAutoRetryParams {
  /** True only for the transient `overloaded` error code. */
  enabled: boolean;
  /** Fires the actual retry (delete failed turn + regenerate). */
  onRetry: () => void;
  /** Parent user message id — stable across the retry's delete+recreate. */
  scopeId?: string;
}

const backoffMs = (attemptsSpent: number): number => {
  const idx = Math.min(attemptsSpent, HETERO_OVERLOAD_BACKOFF_SECONDS.length - 1);
  const base = HETERO_OVERLOAD_BACKOFF_SECONDS[idx];
  // ± jitter so multiple sessions don't retry in lockstep against a struggling
  // upstream. Math.random is fine here (app runtime, not a workflow script).
  const jitter = base * HETERO_OVERLOAD_BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(1, base + jitter) * 1000;
};

/**
 * Drives capped, backed-off auto-retry for heterogeneous "overloaded" errors.
 *
 * The attempt count lives in the store keyed by the parent user message id, so
 * it survives the unmount→remount cycle each retry triggers (the failed
 * assistant message is deleted and a fresh one is created). The timer itself
 * lives here: each mounted overloaded card schedules at most one retry, then
 * unmounts when the retry fires; if the next attempt also overloads, a fresh
 * card mounts, reads the incremented count, and schedules the next (longer)
 * backoff — until the cap is hit.
 *
 * While counting down, a long-lived `autoRetryPending` operation keeps the turn
 * in its loading/in-progress state (so the input stays busy and Stop works
 * across the wait, instead of the turn looking idle between attempts). A retry
 * fired after that operation was cancelled (Stop) aborts instead.
 */
export const useHeterogeneousAutoRetry = ({
  enabled,
  onRetry,
  scopeId,
}: UseHeterogeneousAutoRetryParams): HeteroAutoRetryViewModel | undefined => {
  const attemptsSpent = useConversationStore((s) =>
    scopeId ? (s.heteroOverloadRetryAttempts[scopeId] ?? 0) : 0,
  );
  const recordRetry = useConversationStore((s) => s.recordHeteroOverloadRetry);
  const markExhausted = useConversationStore((s) => s.markHeteroOverloadRetryExhausted);
  const beginWait = useConversationStore((s) => s.internal_beginHeteroOverloadWait);
  const endWait = useConversationStore((s) => s.internal_endHeteroOverloadWait);
  const isWaitAborted = useConversationStore((s) => s.isHeteroOverloadWaitAborted);

  const active = enabled && !!scopeId && attemptsSpent < MAX_HETERO_AUTO_RETRIES;

  const [secondsLeft, setSecondsLeft] = useState(0);
  // Keep the latest onRetry without re-arming the timer when it changes.
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  // Guards against a double-fire (timer + manual "retry now" racing).
  const firedRef = useRef(false);

  const fire = useCallback(() => {
    if (!scopeId || firedRef.current) return;
    firedRef.current = true;
    // Stop (or the cancel action) tore down the wait op while we were counting
    // — don't fire a retry the user asked to abort.
    if (isWaitAborted(scopeId)) {
      markExhausted(scopeId);
      return;
    }
    // Hand the wait off to the real retry attempt (its exec op takes over the
    // loading state), increment so the next card schedules the next backoff.
    endWait(scopeId);
    recordRetry(scopeId);
    onRetryRef.current();
  }, [endWait, isWaitAborted, markExhausted, recordRetry, scopeId]);

  useEffect(() => {
    if (!active || !scopeId) return;
    firedRef.current = false;
    beginWait(scopeId);

    const totalMs = backoffMs(attemptsSpent);
    const deadline = Date.now() + totalMs;
    setSecondsLeft(Math.ceil(totalMs / 1000));

    const ticker = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    const timer = setTimeout(fire, totalMs);

    return () => {
      clearTimeout(timer);
      clearInterval(ticker);
      // Unmounted/cancelled before firing → release the wait op so the turn
      // doesn't stay stuck in a loading state.
      if (!firedRef.current) endWait(scopeId);
    };
  }, [active, scopeId, attemptsSpent, fire, beginWait, endWait]);

  const onCancel = useCallback(() => {
    if (!scopeId) return;
    // Mark fired so a timer callback already dequeued for this tick can't slip
    // through and retry after the user cancelled.
    firedRef.current = true;
    endWait(scopeId);
    markExhausted(scopeId);
  }, [endWait, markExhausted, scopeId]);

  if (!active) return undefined;

  return {
    attempt: attemptsSpent + 1,
    maxAttempts: MAX_HETERO_AUTO_RETRIES,
    onCancel,
    onRetryNow: fire,
    secondsLeft,
  };
};
