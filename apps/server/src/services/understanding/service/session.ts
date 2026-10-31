import {
  StaleUnderstandingSessionError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';

import type { UnderstandingServiceDependencies } from './types';

export const readActiveSession = async (
  dependencies: UnderstandingServiceDependencies,
  topicId: string,
  sessionId: string,
) => {
  await dependencies.topic.assertActiveOnboardingTopic(topicId);
  const session = await dependencies.repository.get(topicId);
  if (!session) throw new UnderstandingSessionNotFoundError(topicId);
  if (session.id !== sessionId) throw new StaleUnderstandingSessionError(sessionId);
  return session;
};
