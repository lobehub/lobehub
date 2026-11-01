'use client';

import { type TopicUrlSyncStore, useTopicUrlSync } from './useTopicUrlSync';

const TopicUrlSync = ({ useStore }: { useStore: TopicUrlSyncStore }) => {
  useTopicUrlSync(useStore);

  return null;
};

export default TopicUrlSync;
