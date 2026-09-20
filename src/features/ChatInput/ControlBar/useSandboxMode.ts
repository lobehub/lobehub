import { useCallback, useSyncExternalStore } from 'react';

import { useChatStore } from '@/store/chat';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
  subscribePendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';
import { topicSelectors } from '@/store/chat/selectors';

export type SandboxMode = 'ephemeral' | 'persistent';

export interface SandboxSelection {
  /** Only meaningful with `persistent`; absent means the workspace root. */
  instanceId?: string;
  /**
   * Absent means nothing has been chosen — which the server runs as ephemeral,
   * but which the picker must not show as the temporary directory being
   * PICKED. A choice is something the user made; the default is not one.
   */
  mode?: SandboxMode;
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
  // The pending value lives outside React, so this subscribes to it the way a
  // store would be subscribed to. Every component using this hook re-renders
  // on a write, not just the one that wrote — a local force-update here left
  // the other reader showing the old value.
  const pending = useSyncExternalStore(subscribePendingSandboxSelection, () =>
    getPendingSandboxSelection(agentId),
  );

  const selection: SandboxSelection = topicId
    ? { instanceId: topicInstanceId, mode: topicMode }
    : (pending ?? {});

  const setSelection = useCallback(
    async (next: SandboxSelection) => {
      if (!topicId) {
        setPendingSandboxSelection(agentId, next);
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
