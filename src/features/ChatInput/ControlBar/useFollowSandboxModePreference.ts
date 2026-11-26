import { useEffect, useRef } from 'react';

import {
  getPendingSandboxSelection,
  isSeededSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { isPersistentSelection, type SandboxSelection } from './useSandboxPlacement';

/**
 * What a conversation not started yet should drop when the agent's drive
 * preference changes under it — typically from another tab, whose switch only
 * reaches this one through the storage event: a default seeded the other way
 * — on the drive while it is now off, or off it while it is now on.
 *
 * Anything picked for this conversation (the drive switch, a folder, an
 * environment) stays. Dropping the slot lets the seeding that follows fill it
 * the new way.
 */
export const staleForMode = (pending: SandboxSelection, temporary: boolean): boolean =>
  isSeededSandboxSelection(pending) && isPersistentSelection(pending) === temporary;

/**
 * Keep a conversation that has not started yet in step with the agent's
 * sandbox mode. Acts on a change of the preference only — never on mount, and
 * never when what changed is whose preference it is (another agent, workspace
 * or user reusing this composer), which only moves the baseline. A member who
 * cannot pick the mode is not moved by it either. Must
 * run before the default is seeded, so an emptied slot is filled in the same
 * pass.
 */
export const useFollowSandboxModePreference = (
  agentId: string,
  {
    enabled,
    hasTopic,
    scopeKey,
    temporary,
  }: {
    /** Whether this member can switch the drive. */
    enabled: boolean;
    hasTopic: boolean;
    /** Whose preference `temporary` is: user, workspace and agent. */
    scopeKey: string;
    /** The stored preference itself, not gated by `enabled`. */
    temporary: boolean;
  },
) => {
  const previous = useRef({ scopeKey, temporary });

  useEffect(() => {
    const before = previous.current;
    previous.current = { scopeKey, temporary };
    if (before.scopeKey !== scopeKey || before.temporary === temporary) return;
    if (!enabled || hasTopic) return;

    const pending = getPendingSandboxSelection(agentId);
    if (pending && staleForMode(pending, temporary)) setPendingSandboxSelection(agentId);
  }, [agentId, enabled, hasTopic, scopeKey, temporary]);
};
