import type { ShareVisitorTopic, ShareVisitorTopicGroup } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getLatestVisitorTopicId, isShareVisitorRoute } from './latestVisitorTopic';

const topic = (id: string, updatedAt: string): ShareVisitorTopic => ({
  createdAt: new Date(updatedAt),
  id,
  preview: null,
  title: null,
  totalCost: 0,
  totalTokens: 0,
  updatedAt: new Date(updatedAt),
});

const group = (visitorId: string, topics: ShareVisitorTopic[]): ShareVisitorTopicGroup => ({
  topics,
  visitor: { avatar: null, id: visitorId, name: null },
});

describe('getLatestVisitorTopicId', () => {
  it('picks the most recently updated topic across visitors', () => {
    expect(
      getLatestVisitorTopicId([
        group('v1', [topic('t1', '2026-11-20T00:00:00Z')]),
        group('v2', [topic('t2', '2026-11-22T00:00:00Z'), topic('t3', '2026-11-01T00:00:00Z')]),
      ]),
    ).toBe('t2');
  });

  it('returns undefined without visitor topics', () => {
    expect(getLatestVisitorTopicId([])).toBeUndefined();
  });
});

describe('isShareVisitorRoute', () => {
  it.each([
    '/agent/agt_1/visitor',
    '/agent/agt_1/visitor/',
    '/agent/agt_1/visitor/tpc_1',
    '/acme/agent/agt_1/visitor/tpc_1',
    '/_dangerous_local_dev_proxy/agent/agt_1/visitor',
  ])('matches %s', (pathname) => {
    expect(isShareVisitorRoute(pathname)).toBe(true);
  });

  it.each(['/agent/agt_1', '/agent/agt_1/share', '/agent/agt_1/tpc_1', '/agent/agt_1/visitor/a/b'])(
    'does not match %s',
    (pathname) => {
      expect(isShareVisitorRoute(pathname)).toBe(false);
    },
  );
});
