import type { QuickNoteResource } from '@/services/quickNote';

/** A product-native surface that opens one object linked from a Quick Note. */
export type QuickNoteOpenTarget =
  | { documentId: string; kind: 'document' }
  | { agentId: string; kind: 'topic'; topicId: string }
  | { kind: 'task'; taskId: string }
  | { goalId: string; kind: 'goal' };

/**
 * Resolves a typed Quick Note resource to its product-native open target.
 *
 * Use when:
 * - A Quick Note surface needs to decide whether a related resource is interactive.
 * - UI code needs a stable modal, drawer, or route target without duplicating type checks.
 *
 * Expects:
 * - Topic-like resources include an owning Agent before their conversation can hydrate.
 * - The resource identifier is already authorized by the server-side resource query.
 *
 * Returns:
 * - A native open target for supported resources, otherwise `undefined`.
 */
export const resolveQuickNoteResourceOpenTarget = (
  resource: QuickNoteResource,
): QuickNoteOpenTarget | undefined => {
  switch (resource.resourceType) {
    case 'document':
    case 'page': {
      return { documentId: resource.resourceId, kind: 'document' };
    }
    case 'conversation':
    case 'topic': {
      if (!resource.agentId) return undefined;

      return {
        agentId: resource.agentId,
        kind: 'topic',
        topicId: resource.resourceId,
      };
    }
    case 'task': {
      return { kind: 'task', taskId: resource.resourceId };
    }
    default: {
      return undefined;
    }
  }
};
