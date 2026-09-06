import type { TrashResourceType } from '@lobechat/types';

import { documentHandler } from './document';
import { fileHandler } from './file';
import { knowledgeBaseHandler } from './knowledgeBase';
import type { TrashHandler } from './types';

/**
 * One handler per trashable kind. `Partial` on purpose: `TrashResourceType`
 * already names the kinds this feature will cover, and they are wired in one
 * at a time (see the phasing table in
 * docs/development/soft-delete-recycle-bin-design.md). Nothing can register a
 * registry row for a kind with no handler, since registration happens inside
 * the handler itself.
 */
export const TRASH_HANDLERS: Partial<Record<TrashResourceType, TrashHandler>> = {
  document: documentHandler,
  file: fileHandler,
  knowledgeBase: knowledgeBaseHandler,
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

export { softDeleteDocuments } from './document';
export { softDeleteFiles } from './file';
export { softDeleteKnowledgeBases } from './knowledgeBase';
export * from './types';
