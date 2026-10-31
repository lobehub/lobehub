import type { ChatTopicMetadata } from '@lobechat/types';
import debug from 'debug';

import type { SandboxSelection } from '@/features/ChatInput/ControlBar/useSandboxPlacement';
import { sandboxStorageService } from '@/services/sandboxStorage';
import { sandboxSelectors, useSandboxStore } from '@/store/sandbox';

const log = debug('lobe-client:sandbox:pending-selection');

/**
 * Module-level singleton for a sandbox selection made before the topic exists.
 *
 * The composer's picker is offered on a conversation that has not been created
 * yet, so there is nothing to write the choice to. Buffering it here keyed by
 * agentId lets the first send carry it: `conversationLifecycle` reads it into
 * the optimistic topic's metadata and `gateway.ts` sends it as
 * `initialTopicMetadata`, so the SERVER topic is born with it.
 *
 * Deliberately not the agent's `agencyConfig`, which is where the device picker
 * keeps its equivalent pre-topic choice. That row is shared by every member of a
 * workspace agent, while a folder choice belongs to one member — writing it there
 * would point other members at storage that is not theirs.
 *
 * Deliberately not persisted either: this is a choice about the conversation
 * being started right now, and a reload before the first message is a new start.
 *
 * Shaped after `pendingTopicRepos`, which solves the same problem for GitHub
 * repositories. Kept separate rather than generalized so that path, which
 * already works, is not disturbed.
 */

const map = new Map<string, SandboxSelection>();

// More than one component reads this — the execution-device switch and the
// working-directory chip — and a Map cannot tell React that it changed. A
// write notifies every subscriber, so a flip in one place moves the other;
// without this, whichever component did not do the writing kept rendering the
// old value until something unrelated re-rendered it.
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Subscribe to writes; returns the unsubscribe. Shaped for `useSyncExternalStore`. */
export const subscribePendingSandboxSelection = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Record the pending selection for an agent; `undefined` clears it. */
export const setPendingSandboxSelection = (agentId: string, selection?: SandboxSelection): void => {
  if (selection) map.set(agentId, selection);
  else map.delete(agentId);
  emit();
};

/**
 * The place an agent's next conversation starts when nobody picks one, and
 * the plan turns out to include a drive. Registered by the composer as soon as
 * it knows the agent runs in the sandbox — before the entitlement has loaded —
 * so a message sent while that request is still in flight is not born without
 * a folder. Kept apart from the pending pick: it is a candidate, and only
 * becomes the pick once the entitlement is confirmed.
 */
const defaults = new Map<string, SandboxSelection>();

/** Register an agent's default placement; `undefined` clears it. */
export const setSandboxDefaultSelection = (agentId: string, selection?: SandboxSelection): void => {
  if (selection) defaults.set(agentId, selection);
  else defaults.delete(agentId);
};

/**
 * Whether the active workspace's plan includes a drive: the composer's cached
 * answer when there is one, the server's otherwise. A failed lookup reads as
 * no — the run goes to the temporary sandbox, as it would have anyway.
 */
const isDriveEntitled = async (): Promise<boolean> => {
  const cached = sandboxSelectors.entitlement(useSandboxStore.getState());
  if (cached) return cached.entitled;

  try {
    return (await sandboxStorageService.getEntitlement()).entitled;
  } catch (error) {
    log('Failed to resolve the drive entitlement for a first send: %O', error);
    return false;
  }
};

/**
 * The selection the first send carries: the pick, if one was made; otherwise
 * the registered default, once the plan is confirmed to include a drive. The
 * default then becomes the pick, so every later reader of this send sees it.
 */
export const resolvePendingSandboxSelection = async (
  agentId: string,
): Promise<SandboxSelection | undefined> => {
  const picked = map.get(agentId);
  if (picked) return picked;

  const fallback = defaults.get(agentId);
  if (!fallback || !(await isDriveEntitled())) return undefined;

  // A pick made while the entitlement was in flight wins over the default.
  if (!map.has(agentId)) setPendingSandboxSelection(agentId, fallback);

  return map.get(agentId);
};

/** Read without consuming — what the closed chip names itself after. */
export const getPendingSandboxSelection = (agentId: string): SandboxSelection | undefined =>
  map.get(agentId);

/**
 * Consume the pending selection for an agent. Cleared so the NEXT conversation
 * starts at the default: the choice was made for the topic that has now been
 * created, and carrying it forward would silently bind conversations nobody
 * chose it for.
 */
export const consumePendingSandboxSelection = (agentId: string): SandboxSelection | undefined => {
  const selection = map.get(agentId);
  map.delete(agentId);
  emit();
  return selection;
};

/** The topic metadata a pending selection becomes when the topic is created with it. */
export const toSandboxTopicMetadata = (
  selection: SandboxSelection | undefined,
): ChatTopicMetadata | undefined =>
  selection && {
    sandboxDrive: selection.drive,
    sandboxEnvironmentId: selection.environmentId,
    sandboxInstanceId: selection.instanceId,
    sandboxWorkingDirectory: selection.workingDirectory,
  };
