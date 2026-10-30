import type { ChannelDetail } from '@lobechat/types';

/** Apply a confirmed deletion to cached pages without losing public conversation history. */
export const retireChannelAgent = (detail: ChannelDetail, agentId: string): ChannelDetail => {
  const memberIds = new Set(
    detail.members.filter((member) => member.agentId === agentId).map((member) => member.id),
  );
  if (!memberIds.size) return detail;
  const retireAuthor = (message: ChannelDetail['messages'][number]) =>
    message.author.type === 'agent' && message.author.id === agentId
      ? { ...message, author: { ...message.author, deleted: true } }
      : message;
  return {
    ...detail,
    jobs: detail.jobs.map((job) =>
      memberIds.has(job.memberId) && (job.status === 'queued' || job.status === 'running')
        ? { ...job, blockedCode: null, publicationRevoked: true, status: 'cancelled' }
        : job,
    ),
    members: detail.members.map((member) =>
      memberIds.has(member.id) ? { ...member, agentDeleted: true, status: 'removed' } : member,
    ),
    messages: detail.messages.map(retireAuthor),
    rootMessage: detail.rootMessage && retireAuthor(detail.rootMessage),
  };
};
