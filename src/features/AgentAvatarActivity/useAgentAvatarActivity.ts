import type { AgentAvatarState } from '@lobehub/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useChatStore } from '@/store/chat';
import {
  agentRunAvatarState,
  isLatestAgentRunCompleted,
} from '@/store/chat/slices/operation/agentRunAvatarState';

/** How long a finished run celebrates (`done`: smiling eyes, two small hops) before idling. */
export const AGENT_AVATAR_DONE_MS = 2400;

const idle = () => undefined;
const isProducing = (state?: AgentAvatarState) => state === 'working' || state === 'thinking';

/**
 * What an Agent's avatar acts out, plus its hover: the avatar plays its run state, and otherwise
 * idles and follows the pointer only while hovered, so a list of idle Agents stays still.
 * `done` plays once, briefly, when a run finishes by itself.
 */
export const useAgentAvatarActivity = (agentId?: string | null) => {
  const busy = useChatStore(agentId ? agentRunAvatarState(agentId) : idle);
  const [hovered, setHovered] = useState(false);
  const [done, setDone] = useState(false);
  const previous = useRef(busy);

  useEffect(() => {
    const was = previous.current;
    previous.current = busy;
    if (busy) {
      setDone(false);
      return;
    }
    if (agentId && isProducing(was) && isLatestAgentRunCompleted(agentId)(useChatStore.getState()))
      setDone(true);
  }, [agentId, busy]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), AGENT_AVATAR_DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const state: AgentAvatarState | undefined = busy ?? (done ? 'done' : undefined);
  const hover = useMemo(
    () => ({
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    }),
    [],
  );

  return {
    avatar: { animated: !!state || hovered, followPointer: hovered, state },
    hover,
    state,
  };
};
