import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type IdentityRolesData, type PersonaData, type PersonaReplicaData } from './projection';

/**
 * The memory home reads (persona + identity roles/tags) are two
 * `@lobechat/replica` single-value resources. Their canonical values live in
 * `personaData` / `identityRolesData`; the long-standing flat fields
 * (`persona`, `personaInit`, `roles`, `tags`, `tagsInit`) are derived mirrors
 * of those views so every existing consumer keeps reading the place it always
 * has.
 */
export interface HomeSliceState {
  /**
   * Canonical replica view of the identity roles + tags aggregate — the single
   * source of truth behind `roles`, `tags` and `tagsInit`. Engine-owned;
   * readers use the flat mirrors.
   */
  identityRolesData?: IdentityRolesData;
  /** Local-first bookkeeping for `identityRolesData`. */
  identityRolesReplica: ReplicaState<IdentityRolesData>;
  /** Mirror of `personaData.persona ?? undefined`. */
  persona?: PersonaData;
  /**
   * Canonical replica view of the persona — the single source of truth behind
   * `persona` and `personaInit`. Engine-owned; readers use the flat mirrors.
   */
  personaData?: PersonaReplicaData;
  /** Whether the persona replica has a value (persisted row hydrated or a response landed). */
  personaInit: boolean;
  /** Local-first bookkeeping for `personaData`. */
  personaReplica: ReplicaState<PersonaReplicaData>;
  /** Mirror of `identityRolesData.roles` (server field `role` renamed to `tag`). */
  roles: { count: number; tag: string }[];
  /** Mirror of `identityRolesData.tags`. */
  tags: { count: number; tag: string }[];
  /** Whether the roles/tags replica has a value (persisted row hydrated or a response landed). */
  tagsInit: boolean;
}

export const homeInitialState: HomeSliceState = {
  identityRolesData: undefined,
  identityRolesReplica: createReplicaState<IdentityRolesData>(),
  persona: undefined,
  personaData: undefined,
  personaInit: false,
  personaReplica: createReplicaState<PersonaReplicaData>(),
  roles: [],
  tags: [],
  tagsInit: false,
};
