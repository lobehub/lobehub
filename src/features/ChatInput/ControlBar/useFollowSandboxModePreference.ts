import { useEffect, useRef } from 'react';

import {
  getPendingSandboxSelection,
  isSeededSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';

/**
 * What a conversation not started yet should drop when the agent's sandbox
 * mode changes under it — typically from another tab, whose pick only reaches
 * this one through the storage event:
 *
 * - now temporary — the drive default seeded here before the change;
 * - now persistent — a bare temporary sandbox, which is all the temporary
 *   mode ever leaves behind.
 *
 * Anything else was picked for this conversation (a folder, a repository) and
 * stays. Dropping the slot lets the seeding that follows fill it the new way.
 */
export const staleForMode = (pending: SandboxSelection, temporary: boolean): boolean =>
  temporary
    ? isSeededSandboxSelection(pending) && isPersistentSelection(pending)
    : !isPersistentSelection(pending) && !pending.environmentId;

/**
 * Keep a conversation that has not started yet in step with the agent's
 * sandbox mode. Runs on a change only, never on mount: a slot filled before
 * the composer opened was filled under the current mode already. Must run
 * before the default is seeded, so an emptied slot is filled in the same pass.
 */
export const useFollowSandboxModePreference = (
  agentId: string,
  { hasTopic, temporary }: { hasTopic: boolean; temporary: boolean },
) => {
  const previous = useRef(temporary);

  useEffect(() => {
    if (previous.current === temporary) return;
    previous.current = temporary;
    if (hasTopic) return;

    const pending = getPendingSandboxSelection(agentId);
    if (pending && staleForMode(pending, temporary)) setPendingSandboxSelection(agentId);
  }, [agentId, hasTopic, temporary]);
};
