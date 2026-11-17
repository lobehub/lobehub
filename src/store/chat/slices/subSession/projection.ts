import { defineReplica } from '@/libs/replica';
import type { OpenedSubSession } from '@/services/subSession';

/** One sidebar page's openers, as a stable key (order-free). */
export const subSessionTreeKey = (openerTopicIds: readonly string[]) =>
  [...openerTopicIds].sort().join(',');

/**
 * The sub-sessions under one sidebar page of topics (`metadata.openedBy`), for
 * the hierarchy. Kept in memory: the page's ids form the key, so persisting
 * every page a user scrolled past would only grow storage.
 */
export const subSessionTreeResource = defineReplica<string[], OpenedSubSession[]>({
  key: subSessionTreeKey,
  name: 'subSessionTree',
  storage: 'memory',
  version: 1,
});
