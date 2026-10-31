import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { hoistCompressedGroups } from './compressedGroupOrder';

const msg = (id: string, role: UIChatMessage['role']): UIChatMessage =>
  ({ content: '', createdAt: 0, id, role, updatedAt: 0 }) as any;

const ids = (messages: UIChatMessage[]) => messages.map((message) => message.id);

describe('hoistCompressedGroups', () => {
  it('returns the same list when the topic has no compressed group', () => {
    const messages = [msg('u1', 'user'), msg('a1', 'assistant')];

    expect(hoistCompressedGroups(messages)).toBe(messages);
  });

  it('moves the group above the user message that triggered it', () => {
    const messages = [msg('u1', 'user'), msg('c1', 'compressedGroup'), msg('a1', 'assistantGroup')];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['c1', 'u1', 'a1']);
  });

  it('keeps a group that is already above the question in place', () => {
    const messages = [msg('c1', 'compressedGroup'), msg('u1', 'user'), msg('a1', 'assistantGroup')];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['c1', 'u1', 'a1']);
  });

  it('lifts each group above its own turn in multi-compression topics', () => {
    const messages = [
      msg('c1', 'compressedGroup'),
      msg('u1', 'user'),
      msg('a1', 'assistantGroup'),
      msg('u2', 'user'),
      msg('c2', 'compressedGroup'),
      msg('a2', 'assistantGroup'),
    ];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['c1', 'u1', 'a1', 'c2', 'u2', 'a2']);
  });

  it('keeps the group at the tail when there is no user message to anchor it to', () => {
    const messages = [msg('a1', 'assistantGroup'), msg('c1', 'compressedGroup')];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['a1', 'c1']);
  });
});
