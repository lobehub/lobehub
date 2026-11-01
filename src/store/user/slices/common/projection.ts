import type { UserInitializationState } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** The bootstrap payload is one entry per identity scope. */
export const USER_STATE_KEY = 'current';

/**
 * The user bootstrap payload (`userService.getUserState()`), one entry per
 * identity scope (`${userId}:${workspaceId}`).
 *
 * Memory-only on purpose. `@/store/user/displaySnapshot` persists *only* the
 * display fields (avatar + preference) for the cold-boot bridge precisely
 * because restoring the whole response would also restore stale entitlement
 * (`isFreePlan` / `subscriptionPlan`) and onboarding state. A persisted replica
 * of this payload would re-introduce exactly that, so the entry is never written
 * to — or hydrated from — storage: every boot fetches it fresh, and the display
 * snapshot keeps painting the identity until that response lands.
 *
 * Built through a factory instead of at module scope: this resource is owned by
 * the user store, and `@/libs/replica` pulls in `@/libs/swr/useCacheScope`,
 * which reads that same store. The store is constructed while that cycle is
 * still initializing, so calling `defineReplica` here at module scope would read
 * it before it is assigned. Create it on first use instead
 * (`CommonActionImpl.#ensureUserState`).
 */
export const createUserStateResource = () =>
  defineReplica<Record<string, never>, UserInitializationState>({
    key: () => USER_STATE_KEY,
    name: 'userState',
    storage: 'memory',
    version: 1,
  });
