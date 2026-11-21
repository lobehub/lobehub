import type { OpenedSubTopic } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** One sidebar page's openers, as a stable key (order-free). */
export const subTopicTreeKey = (openerTopicIds: readonly string[]) =>
  [...openerTopicIds].sort().join(',');

/**
 * The sub-topics under one sidebar page of topics (`metadata.openedBy`), for
 * the hierarchy. Kept in memory: the page's ids form the key, so persisting
 * every page a user scrolled past would only grow storage.
 */
export const subTopicTreeResource = defineReplica<string[], OpenedSubTopic[]>({
  key: subTopicTreeKey,
  name: 'subTopicTree',
  storage: 'memory',
  version: 1,
});
