'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  advanceFundsBlockedSoundCodeSequence,
  INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE,
  syncFundsBlockedSoundFlagFromUrl,
  useFundsBlockedSoundEnabled,
} from './fundsBlockedSoundFlag';
import { playFundsBlockedSound } from './playFundsBlockedSound';
import { useAicoBillingChatGate } from './useAicoBillingChatGate';

/**
 * When the active billing source cannot fund chat, play the funds-blocked cue
 * as the user types (content length grows) — only if the hidden pool-vade flag
 * is unlocked (`?poolVade=1`, typed code `poolvade`, or prior localStorage).
 * Does not restart while already playing.
 */
export const useFundsBlockedComposerCue = () => {
  const { blocked } = useAicoBillingChatGate();
  const soundEnabled = useFundsBlockedSoundEnabled();
  const previousLengthRef = useRef(0);
  const codeSequenceRef = useRef(INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE);

  useEffect(() => {
    syncFundsBlockedSoundFlagFromUrl();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts / IME composition so normal editing is unaffected.
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;

      const result = advanceFundsBlockedSoundCodeSequence(
        codeSequenceRef.current,
        event.key,
        Date.now(),
      );
      codeSequenceRef.current = result.sequence;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onMarkdownContentChange = useCallback(
    (onChange: (content: string) => void) => (content: string) => {
      const nextLength = content.length;
      if (blocked && soundEnabled && nextLength > previousLengthRef.current) {
        playFundsBlockedSound();
      }
      previousLengthRef.current = nextLength;
      onChange(content);
    },
    [blocked, soundEnabled],
  );

  return { blocked, onMarkdownContentChange, soundEnabled };
};
