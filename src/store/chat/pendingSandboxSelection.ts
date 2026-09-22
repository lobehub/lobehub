import type { SandboxSelection } from '@/features/ChatInput/ControlBar/SandboxInstancePicker';

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
 * workspace agent, while an instance belongs to one member — writing it there
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
