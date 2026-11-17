import { isRetiredTopicStatus } from '@lobechat/types';

import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { scheduleWorktreeCleanup } from '@/server/services/worktreeCleanup';

/**
 * The server-side write path for a topic's own fields, status included — and
 * so the one place a topic becomes archived. "Archive" in the UI is
 * `status: 'completed'` (`archived` is a legacy value treated the same), and
 * every archive goes through here: the single and bulk actions, "archive
 * merged PR topics", and any server-side cascade (archive child topics one by
 * one with {@link TopicArchiveService.archiveTopics}).
 *
 * What archiving sets off rides on this path, so no entry point can skip it:
 * today the cleanup of the worktree the app created for the topic. The
 * recycle-bin counterpart is `TrashService.commit`.
 *
 * Authorization stays with the caller (the router checks General access and
 * share-visitor guards before calling).
 */
/** The fields `TopicModel.update` writes. */
type TopicUpdate = Parameters<TopicModel['update']>[1];

export class TopicArchiveService {
  private readonly topicModel: TopicModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.topicModel = new TopicModel(db, userId, workspaceId);
  }

  /**
   * Update a topic. When the update moves it into archived from any other
   * status, the archive's follow-up work is scheduled after the write, with
   * the status it replaced (a run that was still live holds the cleanup).
   */
  async updateTopic(id: string, value: TopicUpdate) {
    const archiving = isRetiredTopicStatus(value.status);
    const previous = archiving ? await this.topicModel.findById(id) : undefined;
    const updated = await this.topicModel.update(id, value);

    if (archiving && previous && !isRetiredTopicStatus(previous.status) && updated.length > 0)
      scheduleWorktreeCleanup({
        db: this.db,
        previousStatus: { [id]: previous.status },
        topicIds: [id],
        trigger: 'archived',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    return updated;
  }

  /** Archive topics, each through {@link updateTopic}. */
  async archiveTopics(ids: string[]) {
    const archived: Awaited<ReturnType<TopicModel['update']>> = [];
    for (const id of ids) {
      archived.push(
        ...(await this.updateTopic(id, { completedAt: new Date(), status: 'completed' })),
      );
    }
    return archived;
  }
}
