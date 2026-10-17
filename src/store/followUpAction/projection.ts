import { defineReplica } from '@/libs/replica';

import type { FollowUpActionSlot } from './initialState';

export interface FollowUpSlotParams {
  conversationKey: string;
}

/**
 * The follow-up chip slot of one conversation (`slots[conversationKey]`).
 *
 * Keyed by the conversation so the concurrent surfaces that own a slot (inbox,
 * popup, thread) each keep their own entry, and partitioned by identity scope
 * so an account / workspace switch never paints another identity's suggestions.
 *
 * Memory-only: a slot holds the suggestions for the *latest* assistant turn,
 * is produced by an event-driven LLM extraction (not a GET over a stable key)
 * and carries the live `AbortController` of the in-flight extraction — so it
 * must never be written to, or hydrated from, storage.
 */
export const followUpSlotResource = defineReplica<FollowUpSlotParams, FollowUpActionSlot>({
  key: ({ conversationKey }) => conversationKey,
  name: 'followUpSlot',
  storage: 'memory',
  version: 1,
});
