import type { ChannelDetail } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { visibleChannelDetail } from './channelAccess';

describe('Channel access after revalidation', () => {
  const cached = { channel: { title: 'Previously accessible' } } as ChannelDetail;
  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])('hides retained content after %s', (code) => {
    expect(visibleChannelDetail(cached, { data: { code } })).toBeUndefined();
  });
  it('retains content on transient transport failures', () => {
    expect(visibleChannelDetail(cached, new Error('network unavailable'))).toBe(cached);
    expect(visibleChannelDetail(cached, undefined)).toBe(cached);
  });
});
