import type { VerifyRunOrigin } from '@lobechat/types';

/**
 * The conversation a report was authored in, as an in-app route. Agent topics
 * live at `/agent/:aid/:topicId`; without the agent there is no route to the
 * topic, so there is no link (the legacy `/chat?topic=` redirects to `/` and
 * drops the topic).
 */
export const originTopicHref = (origin?: VerifyRunOrigin): string | undefined =>
  origin?.agentId && origin.topicId ? `/agent/${origin.agentId}/${origin.topicId}` : undefined;
