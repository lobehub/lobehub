import type { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessagesEngine } from './MessagesEngine';
import type { MessagesEngineParams } from './types';

const user = (id: string): UIChatMessage => ({ id, content: id, role: 'user' }) as UIChatMessage;
const process = (
  invocationId: string,
  messages = [user('u1')],
  overrides: Partial<MessagesEngineParams> = {},
) =>
  new MessagesEngine({
    contextReplay: { invocationId },
    enableSystemDate: false,
    messages,
    model: 'gpt-4',
    provider: 'openai',
    systemRole: 'Original persona',
    ...overrides,
  }).process();

afterEach(() => vi.useRealTimers());

describe('durable context replay', () => {
  it('returns a snapshot owned by the logical invocation', async () => {
    const result = await process('a1');
    expect(result.metadata.contextReplaySnapshot).toMatchObject({ invocationId: 'a1', version: 1 });
  });

  it('keeps the baseline on continuation and isolates a branch before that baseline', async () => {
    const first = await process('a1');
    const previous = {
      id: 'a1',
      content: 'answer',
      role: 'assistant',
      metadata: { contextReplay: first.metadata.contextReplaySnapshot },
    } as UIChatMessage;
    const continuation = await process('a2', [user('u1'), previous, user('u2')]);
    expect(continuation.messages[0]).toEqual(first.messages[0]);
    expect(continuation.metadata.contextReplaySnapshot?.system).toBeUndefined();
    const branch = await process('b1', [user('u1')], { systemRole: 'Independent baseline' });
    expect(JSON.stringify(branch.messages)).toContain('Independent baseline');
    expect(JSON.stringify(branch.messages)).not.toContain('Original persona');
  });

  it('reuses a committed invocation when the wall clock crosses midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T15:59:00Z'));
    const first = await process('a1', [user('u1')], {
      enableSystemDate: true,
      timezone: 'Asia/Singapore',
    });
    vi.setSystemTime(new Date('2026-11-25T16:01:00Z'));
    const retry = await process('a1', [user('u1')], {
      contextReplay: {
        invocationId: 'a1',
        committedSnapshot: first.metadata.contextReplaySnapshot,
      },
      enableSystemDate: true,
      timezone: 'Asia/Singapore',
    });
    expect(retry.messages).toEqual(first.messages);
  });

  it('appends a new date for a new invocation without rewriting the previous prefix', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T15:59:00Z'));
    const first = await process('a1', [user('u1')], {
      enableSystemDate: true,
      timezone: 'Asia/Singapore',
    });
    const previous = {
      id: 'a1',
      content: 'answer',
      role: 'assistant',
      metadata: { contextReplay: first.metadata.contextReplaySnapshot },
    } as UIChatMessage;
    vi.setSystemTime(new Date('2026-11-25T16:01:00Z'));
    const next = await process('a2', [user('u1'), previous, user('u2')], {
      enableSystemDate: true,
      timezone: 'Asia/Singapore',
    });
    expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(JSON.stringify(next.messages.slice(first.messages.length))).toContain('2026-11-26');
  });
});
