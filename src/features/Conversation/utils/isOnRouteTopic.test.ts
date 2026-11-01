import { describe, expect, it } from 'vitest';

import { isOnRouteTopic } from './isOnRouteTopic';

describe('isOnRouteTopic', () => {
  /**
   * @example Project home: `…/conversation/tpc_1?message=` was sent while the
   * conversation still had no topic, so the send started a second topic outside
   * the project and the page reported "topic not found".
   */
  it('holds a topic URL until the conversation is on that topic', () => {
    expect(isOnRouteTopic('tpc_1', undefined)).toBe(false);
    expect(isOnRouteTopic('tpc_1', null)).toBe(false);
    expect(isOnRouteTopic('tpc_1', 'tpc_previous')).toBe(false);
    expect(isOnRouteTopic('tpc_1', 'tpc_1')).toBe(true);
  });

  it('lets a URL without a topic start a new conversation', () => {
    expect(isOnRouteTopic(undefined, undefined)).toBe(true);
    expect(isOnRouteTopic(undefined, 'tpc_1')).toBe(true);
  });
});
