import { describe, expect, it } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { isMainComposer } from './isMainComposer';

const main = { agentId: 'agent-1', topicId: 'topic-1' };
const registered = { attached: true, contextKey: messageMapKey(main) };

describe('isMainComposer', () => {
  it('accepts the conversation the main composer registered', () => {
    expect(isMainComposer(main, registered)).toBe(true);
    expect(isMainComposer({ ...main, scope: 'main' }, registered)).toBe(true);
  });

  it('rejects a page or task copilot mirroring the active agent and topic', () => {
    expect(isMainComposer({ ...main, scope: 'page' }, registered)).toBe(false);
    expect(isMainComposer({ ...main, scope: 'task' }, registered)).toBe(false);
  });

  it('rejects a host the main composer did not register, such as a share page', () => {
    expect(isMainComposer(main, { attached: false })).toBe(false);
    expect(isMainComposer(main, { attached: true, contextKey: 'other' })).toBe(false);
  });

  it('rejects group conversations and threads', () => {
    expect(isMainComposer({ ...main, groupId: 'group-1' }, registered)).toBe(false);
    expect(isMainComposer({ ...main, threadId: 'thread-1' }, registered)).toBe(false);
  });
});
