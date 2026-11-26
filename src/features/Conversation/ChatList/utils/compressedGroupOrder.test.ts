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

  it('keeps a pending /compact group after the turn it follows', () => {
    const pending = { ...msg('c1', 'compressedGroup'), metadata: { keepPosition: true } } as any;
    const messages = [msg('u1', 'user'), msg('a1', 'assistantGroup'), pending];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['u1', 'a1', 'c1']);
  });

  it('keeps a thread summary below the main-conversation turn the thread branched from', () => {
    const messages = [
      { ...msg('u1', 'user'), threadId: null },
      { ...msg('a1', 'assistant'), threadId: null },
      { ...msg('c1', 'compressedGroup'), threadId: 'thread-1' },
    ];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['u1', 'a1', 'c1']);
  });

  it('still lifts a thread summary above the thread turn that triggered it', () => {
    const messages = [
      { ...msg('u1', 'user'), threadId: null },
      { ...msg('a1', 'assistant'), threadId: null },
      { ...msg('tu1', 'user'), threadId: 'thread-1' },
      { ...msg('c1', 'compressedGroup'), threadId: 'thread-1' },
      { ...msg('ta1', 'assistantGroup'), threadId: 'thread-1' },
    ];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['u1', 'a1', 'c1', 'tu1', 'ta1']);
  });

  it('keeps the group at the tail when there is no user message to anchor it to', () => {
    const messages = [msg('a1', 'assistantGroup'), msg('c1', 'compressedGroup')];

    expect(ids(hoistCompressedGroups(messages))).toEqual(['a1', 'c1']);
  });
});
