interface ResourceEventIdentity {
  actorId?: string;
  type?: string;
}

/** Events that must still refresh another window signed in as the same actor. */
const SAME_USER_FANOUT_EVENTS = new Set(['document.commentsChanged', 'document.likesChanged']);

export const shouldIgnoreResourceEvent = (
  event: ResourceEventIdentity,
  currentUserId?: string,
): boolean =>
  !SAME_USER_FANOUT_EVENTS.has(event.type ?? '') &&
  Boolean(event.actorId && currentUserId && event.actorId === currentUserId);
