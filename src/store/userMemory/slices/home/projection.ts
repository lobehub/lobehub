import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { defineReplica } from '@/libs/replica';
import { userMemoryKeys } from '@/libs/swr/keys';

/**
 * The persona is a single row per scope; the key never varies, so one entry
 * backs every reader of the memory home page.
 */
export const PERSONA_KEY = 'persona';

/**
 * The identity roles + tags aggregate is a single row per scope; the key never
 * varies, so one entry backs the home role/tag cloud.
 */
export const IDENTITY_ROLES_KEY = 'identityRoles';

/**
 * The window the home role/tag cloud asks for — mirrors the pre-migration
 * `queryIdentityRoles({ page: 1, size: 64 })` call.
 */
export const IDENTITY_ROLES_QUERY = { page: 1, size: 64 } as const;

/**
 * Both home reads take no query params: one fixed value per scope. The paging
 * window is baked into the fetcher, so it is not part of the query identity.
 */
export type HomeReplicaParams = Record<string, never>;

/**
 * The persona sub-model returned by `userMemory.getPersona` (`null` = the user
 * has no persona yet).
 */
export interface PersonaData {
  content: string;
  summary: string;
}

/**
 * Persona replica value. The persona is wrapped in an object so a
 * server-confirmed absence (`persona: null`) is a real, persisted value rather
 * than "no value" — a bare `null` would be indistinguishable from a missing
 * entry once folded by the engine.
 */
export interface PersonaReplicaData {
  persona: PersonaData | null;
}

/** Identity roles + tags aggregate (the `userMemory:tags` read). */
export type IdentityRolesData = QueryIdentityRolesResult;

/**
 * The memory persona (`userMemory.getPersona`): one local-first replica per
 * scope, so a revisit paints the persisted persona before the network answers.
 *
 * It adopts the long-standing `userMemory:persona` SWR key as its sync key, so
 * existing revalidation by that key (the persona delete flow) still lands in
 * the replica.
 */
export const personaResource = defineReplica<HomeReplicaParams, PersonaReplicaData>({
  key: () => PERSONA_KEY,
  name: 'userMemoryPersona',
  storage: 'indexedDB',
  syncKey: () => userMemoryKeys.persona(),
  version: 1,
});

/**
 * The memory identity roles + tags aggregate (`userMemoryMemories.queryIdentityRoles`):
 * one local-first replica per scope, so the home role/tag cloud paints the
 * persisted copy before the network answers.
 *
 * It adopts the long-standing `userMemory:tags` SWR key as its sync key, so
 * existing revalidation by that key (a memory purge) still lands in the
 * replica.
 */
export const identityRolesResource = defineReplica<HomeReplicaParams, IdentityRolesData>({
  key: () => IDENTITY_ROLES_KEY,
  name: 'userMemoryIdentityRoles',
  storage: 'indexedDB',
  syncKey: () => userMemoryKeys.tags(),
  version: 1,
});
