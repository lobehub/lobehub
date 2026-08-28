import { isNull } from 'drizzle-orm';

import { topics } from '../schemas';

/**
 * "This conversation did not come from an agent share."
 *
 * An agent-share visitor topic belongs to the VISITOR (`topics.userId` is the
 * visitor), so every user-scoped creator-facing query is isolated from it by
 * construction and needs no predicate at all. This one exists for the opposite
 * shape: SYSTEM-scoped background jobs that scan `topics` across all users and
 * would otherwise act on a share conversation on its owner's behalf, spending
 * their money on a conversation the shared agent's creator is supposed to be
 * funding.
 *
 * Matched on `shareId`, not the deprecated `senderId` — see `topics.shareId`'s
 * JSDoc (`../schemas/topic.ts`), which is the topic's only provenance marker.
 */
export const notShareTopic = () => isNull(topics.shareId);
