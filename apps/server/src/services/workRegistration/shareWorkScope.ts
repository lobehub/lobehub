import { agentShareWorkAccessScope, type WorkAccessScope } from '@lobechat/types';

/** The share-visitor marker slice every Work registration path needs. */
export interface ShareVisitorWorkIdentity {
  shareId: string;
  visitorUserId: string;
}

/**
 * Resolve the `WorkAccessScope` an agent run registers/reads Works under.
 *
 * - No share visitor → `undefined`, i.e. the ordinary (creator-facing) scope.
 * - Share visitor + topic → the share scope pinned to that visitor topic, so
 *   the registered Work is fenced off from the creator's ordinary surfaces.
 * - Share visitor WITHOUT a topic → `null`. Callers must skip registration:
 *   a share run's Work can only ever be served back through its visitor
 *   topic, and registering it unscoped would leak it into the creator's lists.
 */
export const resolveRunWorkAccessScope = (params: {
  shareVisitor?: ShareVisitorWorkIdentity | null;
  topicId?: string | null;
}): WorkAccessScope | null | undefined => {
  const { shareVisitor, topicId } = params;
  if (!shareVisitor) return undefined;
  if (!topicId) return null;

  return agentShareWorkAccessScope({
    shareId: shareVisitor.shareId,
    topicId,
    visitorUserId: shareVisitor.visitorUserId,
  });
};
