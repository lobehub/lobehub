import { CLIENT_ALLOCATABLE_PREFIXES, type ClientAllocatableEntity } from '@lobechat/types';

import { createNanoId } from './uuid';

/**
 * Mint an id for an entity the client is allowed to name.
 *
 * Mirrors `idGenerator` in `@lobechat/database` (same alphabet, same prefix
 * table) so a client-minted id is indistinguishable from a server-minted one —
 * which is the point: the row can be rendered, referenced and updated before it
 * has ever reached the server, and nothing has to be re-keyed afterwards.
 */
export const generateEntityId = (entity: ClientAllocatableEntity, size = 12): string =>
  `${CLIENT_ALLOCATABLE_PREFIXES[entity]}_${createNanoId(size)()}`;
