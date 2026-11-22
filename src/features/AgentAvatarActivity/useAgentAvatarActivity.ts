import type { AgentAvatarState } from '@lobehub/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useChatStore } from '@/store/chat';
import {
  agentRunAvatarState,
  isLatestAgentRunCompleted,
} from '@/store/chat/slices/operation/agentRunAvatarState';

/** How long a finished run celebrates (`done`: smiling eyes, two small hops) before idling. */
export const AGENT_AVATAR_DONE_MS = 2400;

/**
 * How long after a run stops showing as busy it may still report how it ended. A client run hides
 * its loading state before its operation is marked completed.
 */
export const AGENT_AVATAR_SETTLE_MS = 8000;

const idle = () => undefined;
const never = () => false;
const isProducing = (state?: AgentAvatarState) => state === 'working' || state === 'thinking';

/**
 * What an Agent's avatar acts out, plus its hover: the avatar plays its run state, and otherwise
 * idles and follows the pointer only while hovered, so a list of idle Agents stays still.
 * `done` plays once, briefly, when a run finishes by itself.
 */
export const useAgentAvatarActivity = (agentId?: string | null) => {
  const busy = useChatStore(agentId ? agentRunAvatarState(agentId) : idle);
  const completed = useChatStore(agentId ? isLatestAgentRunCompleted(agentId) : never);
  const [hovered, setHovered] = useState(false);
  // Held per Agent: a shared surface such as the sidebar header changes `agentId` while mounted.
  const [doneAgentId, setDoneAgentId] = useState<string | null>(null);
  const done = !!agentId && doneAgentId === agentId;
  const trackedAgentId = useRef(agentId);
  const previous = useRef(busy);
  const settlingUntil = useRef(0);

  useEffect(() => {
    const was = trackedAgentId.current === agentId ? previous.current : undefined;
    if (trackedAgentId.current !== agentId) settlingUntil.current = 0;
    trackedAgentId.current = agentId;
    previous.current = busy;
    if (busy) {
      settlingUntil.current = 0;
      setDoneAgentId(null);
      return;
    }
    if (isProducing(was)) settlingUntil.current = Date.now() + AGENT_AVATAR_SETTLE_MS;
    if (!completed || Date.now() > settlingUntil.current) return;

    settlingUntil.current = 0;
    setDoneAgentId(agentId ?? null);
  }, [agentId, busy, completed]);

  useEffect(() => {
    if (!doneAgentId) return;
    const timer = setTimeout(() => setDoneAgentId(null), AGENT_AVATAR_DONE_MS);
    return () => clearTimeout(timer);
  }, [doneAgentId]);

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
