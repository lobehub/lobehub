'use client';

import { useCallback, useRef } from 'react';

import { playFundsBlockedSound } from './playFundsBlockedSound';
import { useAicoBillingChatGate } from './useAicoBillingChatGate';

/**
 * When the active billing source cannot fund chat, play the funds-blocked cue
 * as the user types (content length grows). Does not restart while already playing.
 */
export const useFundsBlockedComposerCue = () => {
  const { blocked } = useAicoBillingChatGate();
  const previousLengthRef = useRef(0);

  const onMarkdownContentChange = useCallback(
    (onChange: (content: string) => void) => (content: string) => {
      const nextLength = content.length;
      if (blocked && nextLength > previousLengthRef.current) {
        playFundsBlockedSound();
      }
      previousLengthRef.current = nextLength;
      onChange(content);
    },
    [blocked],
  );

  return { blocked, onMarkdownContentChange };
};
