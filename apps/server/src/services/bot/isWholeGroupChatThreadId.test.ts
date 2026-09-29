import { describe, expect, it } from 'vitest';

import { isWholeGroupChatThreadId } from './isWholeGroupChatThreadId';

describe('isWholeGroupChatThreadId', () => {
  it('treats Feishu/Lark group mains as whole-group chats', () => {
    expect(isWholeGroupChatThreadId('feishu:group:oc_citic_sentry')).toBe(true);
    expect(isWholeGroupChatThreadId('lark:group:oc_xxx')).toBe(true);
    expect(isWholeGroupChatThreadId('feishu:oc_legacy')).toBe(true);
  });

  it('leaves nested Feishu topics and other platforms alone', () => {
    expect(isWholeGroupChatThreadId('feishu:group:oc_citic_sentry:omt_topic_1')).toBe(false);
    expect(isWholeGroupChatThreadId('discord:guild-1:channel-1:thread-1')).toBe(false);
    expect(isWholeGroupChatThreadId('slack:C_GENERAL:1715000000.000100')).toBe(false);
    expect(isWholeGroupChatThreadId('telegram:chat-1')).toBe(false);
  });
});
