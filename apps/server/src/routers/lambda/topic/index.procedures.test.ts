// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { topicRouter } from '.';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('topicRouter procedures', () => {
  const procedures = (topicRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['batchCreateTopics', 'mutation', 13],
    ['batchDelete', 'mutation', 13],
    ['batchDeleteByAgentId', 'mutation', 13],
    ['batchDeleteByGroupId', 'mutation', 13],
    ['batchDeleteBySessionId', 'mutation', 13],
    ['batchMoveTopics', 'mutation', 13],
    ['branchTopicAtMessage', 'mutation', 13],
    ['cancelRateLimitContinuation', 'mutation', 13],
    ['cloneTopic', 'mutation', 13],
    ['countTopics', 'query', 12],
    ['createTopic', 'mutation', 13],
    ['disableSharing', 'mutation', 13],
    ['enableSharing', 'mutation', 13],
    ['forkTopic', 'mutation', 13],
    ['getHeteroSessionImportStatus', 'query', 11],
    ['getMaxTaskDuration', 'query', 11],
    ['getShareInfo', 'query', 12],
    ['getTopicContext', 'query', 12],
    ['getTopicDetail', 'query', 12],
    ['getTopicTranscript', 'query', 12],
    ['getTopics', 'query', 12],
    ['hasTopicFiles', 'query', 13],
    ['hasTopics', 'query', 11],
    ['importHeteroSessions', 'mutation', 13],
    ['importTopic', 'mutation', 13],
    ['markTopicRead', 'mutation', 13],
    ['queryTopics', 'query', 12],
    ['rankTopics', 'query', 12],
    ['recentTopics', 'query', 12],
    ['removeAllTopics', 'mutation', 12],
    ['removeTopic', 'mutation', 13],
    ['searchTopics', 'query', 13],
    ['settleRunningOperation', 'mutation', 13],
    ['updateShareVisibility', 'mutation', 13],
    ['updateTopic', 'mutation', 13],
    ['updateTopicMetadata', 'mutation', 13],
    ['updateTopicModel', 'mutation', 13],
  ];
}
