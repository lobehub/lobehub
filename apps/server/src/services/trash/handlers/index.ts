import type { TrashResourceType } from '@lobechat/types';

import { topicHandler } from './topic';
import type { TrashHandler } from './types';

/**
 * One handler per trashable kind. `Partial` on purpose: `TrashResourceType`
 * already names the kinds this feature will cover, and they are wired in one
 * at a time (topic first — see the phasing table in
 * docs/development/soft-delete-recycle-bin-design.md). Nothing can register a
 * registry row for a kind with no handler, since registration happens inside
 * the handler itself.
 */
export const TRASH_HANDLERS: Partial<Record<TrashResourceType, TrashHandler>> = {
  topic: topicHandler,
};

/**
 * A registry row whose kind has no handler can only come from a newer version
 * of the app writing rows this one does not understand — surface it instead of
 * silently skipping the row and leaving it in the bin forever.
 */
export const resolveTrashHandler = (resourceType: TrashResourceType): TrashHandler => {
  const handler = TRASH_HANDLERS[resourceType];
  if (!handler) throw new Error(`No recycle-bin handler for resource type "${resourceType}"`);
  return handler;
};

export { topicCascades } from './topic';
export * from './types';
