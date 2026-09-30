import { describe, expect, it } from 'vitest';

import { isWholeGroupChatThreadId } from './isWholeGroupChatThreadId';

describe('isWholeGroupChatThreadId', () => {
  it('classifies Feishu/Lark group chats as whole-group conversations', () => {
    expect(isWholeGroupChatThreadId('feishu:group:oc_citic_sentry')).toBe(true);
    expect(isWholeGroupChatThreadId('lark:group:oc_xxx')).toBe(true);
  });

  it('leaves Feishu/Lark 1:1 chats and type-less ids alone', () => {
    expect(isWholeGroupChatThreadId('feishu:p2p:oc_xxx')).toBe(false);
    expect(isWholeGroupChatThreadId('lark:p2p:oc_xxx')).toBe(false);
    // Ids without an encoded chat type cannot be proven to be group mains, so
    // they keep the pre-existing behaviour.
    expect(isWholeGroupChatThreadId('feishu:oc_legacy')).toBe(false);
    expect(isWholeGroupChatThreadId('lark:oc_legacy')).toBe(false);
  });

  it('leaves other platforms alone', () => {
    expect(isWholeGroupChatThreadId('discord:guild-1:channel-1:thread-1')).toBe(false);
    expect(isWholeGroupChatThreadId('slack:C_GENERAL:1715000000.000100')).toBe(false);
    expect(isWholeGroupChatThreadId('telegram:chat-1')).toBe(false);
  });
});
