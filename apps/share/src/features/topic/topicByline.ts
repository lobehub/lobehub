import { DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';

import { type SharedTopicData } from '@/types/topic';

export const buildTopicByline = (data: SharedTopicData) => {
  const isInboxAgent = !data.groupId && data.agentMeta?.slug === 'inbox';

  return (
    data.groupMeta?.title ||
    agentDisplayName(data.agentMeta, isInboxAgent ? DEFAULT_INBOX_TITLE : '') ||
    undefined
  );
};
