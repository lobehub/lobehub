import { DEFAULT_INBOX_TITLE } from '@lobechat/const';

import { type SharedTopicData } from '@/types/topic';

export const buildTopicByline = (data: SharedTopicData) => {
  const isInboxAgent = !data.groupId && data.agentMeta?.slug === 'inbox';

  return data.groupMeta?.title || (isInboxAgent ? DEFAULT_INBOX_TITLE : data.agentMeta?.title);
};
