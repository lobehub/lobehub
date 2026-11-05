import { describe, expect, it } from 'vitest';

import { formatDingTalkThreadId, parseDingTalkChannelId, parseDingTalkThreadId } from './threadId';

describe('DingTalk thread ids', () => {
  it.each([
    ['dingtalk:group:cid1==', { id: 'cid1==', type: 'group' }],
    ['dingtalk:single:staff1', { id: 'staff1', type: 'single' }],
    ['dingtalk:single:$:LWCP_v1:$abc', { id: '$:LWCP_v1:$abc', type: 'single' }],
    ['cid1==', { id: 'cid1==', type: 'group' }],
    ['dingtalk:other:x', { id: 'dingtalk:other:x', type: 'group' }],
  ])('parses %s', (threadId, expected) => {
    expect(parseDingTalkThreadId(threadId)).toEqual(expected);
  });

  it('round-trips through format', () => {
    const conversation = { id: '$:LWCP_v1:$abc', type: 'single' as const };
    expect(parseDingTalkThreadId(formatDingTalkThreadId(conversation))).toEqual(conversation);
  });

  it.each([
    ['group:cid1', { id: 'cid1', type: 'group' }],
    ['single:staff1', { id: 'staff1', type: 'single' }],
    ['dingtalk:single:staff1', { id: 'staff1', type: 'single' }],
    ['cid1', { id: 'cid1', type: 'group' }],
  ])('parses channel id %s', (channelId, expected) => {
    expect(parseDingTalkChannelId(channelId)).toEqual(expected);
  });
});
