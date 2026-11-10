import type { SQL } from 'drizzle-orm';
import { and } from 'drizzle-orm';

import { messages, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';

/** Caller identity every TopicRepository write is scoped to. */
export interface TopicRepositoryScope {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** Creator-facing topic scope: workspace/user ownership minus share-visitor topics. */
export const topicOwnership = (scope: TopicRepositoryScope): SQL | undefined =>
  and(
    buildWorkspaceWhere({ userId: scope.userId, workspaceId: scope.workspaceId }, topics),
    notShareVisitorTopic(),
  );

export const messageOwnership = (scope: TopicRepositoryScope): SQL | undefined =>
  buildWorkspaceWhere({ userId: scope.userId, workspaceId: scope.workspaceId }, messages);
