import type { QuickNoteResource } from '@/services/quickNote';

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
export const resolveQuickNoteResourceOpenTarget = (resource: QuickNoteResource) => {
  switch (resource.resourceType) {
    case 'document':
    case 'page': {
      return { documentId: resource.resourceId, kind: 'document' as const };
    }
    case 'conversation':
    case 'topic': {
      if (!resource.agentId) return undefined;

      return {
        agentId: resource.agentId,
        kind: 'topic' as const,
        topicId: resource.resourceId,
      };
    }
    case 'task': {
      return { kind: 'task' as const, taskId: resource.resourceId };
    }
    default: {
      return undefined;
    }
  }
};
