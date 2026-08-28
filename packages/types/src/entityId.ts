/**
 * Entity ids a client is allowed to allocate itself.
 *
 * Ids are plain `nanoid/non-secure` values behind a namespace prefix — they
 * carry no sequence, no server secret and no database state, so a client can
 * mint one before the row exists and the server can honour it verbatim. That is
 * what lets a conversation own its real topic / message ids from the first
 * keystroke instead of swapping placeholder ids once the server answers.
 *
 * Kept here (a zero-dependency package) so both the edge schemas and the client
 * generator share one definition; `@lobechat/utils` builds the generator on top.
 * Prefixes mirror `idGenerator`'s table in `@lobechat/database`.
 */
export const CLIENT_ALLOCATABLE_PREFIXES = {
  messages: 'msg',
  threads: 'thd',
  topics: 'tpc',
} as const;

export type ClientAllocatableEntity = keyof typeof CLIENT_ALLOCATABLE_PREFIXES;

/**
 * Length bounds for the random part. The server mints 12 chars by default and
 * 16 for threads, and the heterogeneous-agent path already mints 18 for
 * messages, so this has to be a range: it keeps every existing producer valid
 * while still rejecting free-form strings.
 */
const MIN_HASH_LENGTH = 8;
const MAX_HASH_LENGTH = 32;

const hashPattern = `[0-9a-zA-Z]{${MIN_HASH_LENGTH},${MAX_HASH_LENGTH}}`;

/**
 * Regex for a well-formed id of `entity`.
 *
 * The server MUST validate any client-supplied id with this before it reaches
 * the database. Without it a client could submit an arbitrary primary key —
 * look-alike ids (`msg_admin`), oversized values, or strings that leak into
 * logs and URLs.
 */
export const entityIdPattern = (entity: ClientAllocatableEntity): RegExp =>
  new RegExp(`^${CLIENT_ALLOCATABLE_PREFIXES[entity]}_${hashPattern}$`);

export const isValidEntityId = (entity: ClientAllocatableEntity, id: string): boolean =>
  entityIdPattern(entity).test(id);
