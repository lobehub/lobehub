import { useCallback, useReducer } from 'react';

import { useChatStore } from '@/store/chat';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';
import { topicSelectors } from '@/store/chat/selectors';

export type SandboxMode = 'ephemeral' | 'persistent';

export interface SandboxSelection {
  /** Only meaningful with `persistent`; absent means the workspace root. */
  instanceId?: string;
  mode: SandboxMode;
}

/**
 * What the current conversation's cloud sandbox keeps, read and written from
 * one place.
 *
 * Two surfaces answer this — the execution-device menu (keep files or not) and
 * the working-directory chip (which directory) — and both must see the same
 * state, or a toggle in one would not move the other. Absent means ephemeral,
 * which is how the server reads it too (`sandboxMode !== 'persistent'`).
 *
 * Before a topic exists the choice is buffered by agent and carried by the
 * first send; see `pendingSandboxSelection`.
 */
export const useSandboxMode = (agentId: string) => {
  const topicId = useChatStore((s) => s.activeTopicId);
  const topicInstanceId = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.sandboxInstanceId,
  );
  const topicMode = useChatStore((s) => topicSelectors.currentTopicMetadata(s)?.sandboxMode);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  // The pending value lives outside React, so a write to it has to ask for the
  // re-render that a store write would have given us.
  const [, rerender] = useReducer((tick: number) => tick + 1, 0);

  const selection: SandboxSelection = topicId
    ? { instanceId: topicInstanceId, mode: topicMode === 'persistent' ? 'persistent' : 'ephemeral' }
    : (getPendingSandboxSelection(agentId) ?? { mode: 'ephemeral' });

  const setSelection = useCallback(
    async (next: SandboxSelection) => {
      if (!topicId) {
        setPendingSandboxSelection(agentId, next);
        rerender();
        return;
      }

      // Written whole, both fields every time. Deriving the mode from "did they
      // pick an instance" is what made this a one-way switch: nothing could then
      // express "keep nothing", so a conversation that once touched this menu
      // could never go back to a throwaway box.
      await updateTopicMetadata(topicId, {
        sandboxInstanceId: next.instanceId,
        sandboxMode: next.mode,
      });
    },
    [agentId, topicId, updateTopicMetadata],
  );

  // Turning persistence off also drops the instance: a binding kept behind an
  // ephemeral run would silently come back the next time the switch is on.
  const setMode = useCallback(
    (mode: SandboxMode) =>
      setSelection(mode === 'persistent' ? { ...selection, mode } : { mode: 'ephemeral' }),
    [selection, setSelection],
  );

  return { selection, setMode, setSelection, topicId: topicId ?? undefined };
};
