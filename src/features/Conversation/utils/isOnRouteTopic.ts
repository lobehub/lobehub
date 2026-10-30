/**
 * A deferred send on a topic URL (`…/:topicId?message=`) belongs to that
 * topic. The conversation context adopts the route's topic a render after the
 * page mounts; a send before then reads "no topic" and starts a new one, which
 * the page then navigates to instead of the topic the link named.
 */
export const isOnRouteTopic = (
  routeTopicId: string | undefined,
  contextTopicId: string | null | undefined,
) => !routeTopicId || contextTopicId === routeTopicId;
