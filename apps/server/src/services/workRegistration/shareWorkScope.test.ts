import { describe, expect, it } from 'vitest';

import { resolveRunWorkAccessScope } from './shareWorkScope';

describe('resolveRunWorkAccessScope', () => {
  it('returns undefined (ordinary scope) for a creator run', () => {
    expect(resolveRunWorkAccessScope({ shareVisitor: null, topicId: 'tpc_1' })).toBeUndefined();
    expect(resolveRunWorkAccessScope({ topicId: 'tpc_1' })).toBeUndefined();
  });

  it('pins a share visitor run to its visitor topic', () => {
    expect(
      resolveRunWorkAccessScope({
        shareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
        topicId: 'tpc_1',
      }),
    ).toEqual({
      shareId: 'share-1',
      topicId: 'tpc_1',
      type: 'agentShare',
      visitorUserId: 'visitor-1',
    });
  });

  it('returns null (fail closed) for a share visitor run without a topic', () => {
    expect(
      resolveRunWorkAccessScope({
        shareVisitor: { shareId: 'share-1', visitorUserId: 'visitor-1' },
        topicId: undefined,
      }),
    ).toBeNull();
  });
});
