interface ResourceEventIdentity {
  actorId?: string;
  type?: string;
}

export const shouldIgnoreResourceEvent = (
  event: ResourceEventIdentity,
  currentUserId?: string,
): boolean =>
  event.type !== 'document.commentsChanged' &&
  Boolean(event.actorId && currentUserId && event.actorId === currentUserId);
