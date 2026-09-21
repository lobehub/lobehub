import type { LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';

export class TopicReferenceService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  getTopicContext = async ({ topicId }: { topicId: string }) => {
    if (!topicId) return { content: 'topicId is required', success: false };

    let topic = await new TopicModel(this.db, this.userId, this.workspaceId).findOwnTopicById(
      topicId,
    );

    if (!topic && this.workspaceId) {
      topic = await new TopicModel(this.db, this.userId).findOwnTopicById(topicId);
    }

    if (!topic) return { content: `Topic not found: ${topicId}`, success: false };

    const title = topic.title || 'Untitled';
    if (topic.historySummary) {
      return { content: `# Topic: ${title}\n\n## Summary\n${topic.historySummary}`, success: true };
    }

    const messages = await new MessageModel(
      this.db,
      this.userId,
      topic.workspaceId ?? undefined,
    ).query({
      agentId: topic.agentId ?? undefined,
      groupId: topic.groupId ?? undefined,
      topicId,
    });

    const lines = [`# Topic: ${title}`, '', '## Recent Messages', ''];
    for (const message of messages.slice(-30)) {
      const role =
        message.role === 'user'
          ? 'User'
          : message.role === 'assistant'
            ? 'Assistant'
            : message.role;
      const content = (message.content || '').trim();
      if (content) lines.push(`**${role}**: ${content}`, '');
    }

    return { content: lines.join('\n'), success: true };
  };
}
