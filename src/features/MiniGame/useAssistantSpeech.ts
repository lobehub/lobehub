import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';
import { useEffect, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';

/** How long a line stays above the character after it last changed. */
export const SPEECH_VISIBLE_MS = 8000;
const MAX_SPEECH_LENGTH = 60;

const toSpeech = (content: string | undefined): string | undefined => {
  const text = content
    ?.replaceAll(/[#*_`>]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (!text || text === LOADING_FLAT) return;
  return text.length > MAX_SPEECH_LENGTH ? `${text.slice(0, MAX_SPEECH_LENGTH)}…` : text;
};

/**
 * What the agent says last in the current conversation: the newest text of
 * the trailing assistant message (for a tool-using reply, its latest step).
 * Nothing once the user speaks again.
 */
export const latestAssistantSpeech = (messages: UIChatMessage[]): string | undefined => {
  const last = messages.at(-1);
  if (!last) return;
  if (last.role === 'assistant') return toSpeech(last.content);
  if (last.role !== 'assistantGroup') return;

  const children = last.children ?? [];
  for (let i = children.length - 1; i >= 0; i--) {
    const speech = toSpeech(children[i].content);
    if (speech) return speech;
  }
};

/** The agent's chat reply mirrored as a speech bubble, hidden after a while. */
export const useAssistantSpeech = (): string | undefined => {
  const speech = useChatStore((s) =>
    latestAssistantSpeech(displayMessageSelectors.activeDisplayMessages(s)),
  );
  const [expired, setExpired] = useState<string>();

  useEffect(() => {
    // A new line (or the user speaking) starts over: the agent may say the
    // very same words again in its next reply, and they must show again.
    setExpired(undefined);
    if (!speech) return;
    const timer = setTimeout(() => setExpired(speech), SPEECH_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [speech]);

  return speech && speech !== expired ? speech : undefined;
};
