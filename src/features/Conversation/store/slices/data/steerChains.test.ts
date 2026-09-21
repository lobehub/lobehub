import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectSteerChains } from './steerChains';

const msg = (
  id: string,
  role: UIChatMessage['role'],
  metadata?: UIChatMessage['metadata'],
): UIChatMessage => ({ content: '', createdAt: 0, id, metadata, role, updatedAt: 0 }) as any;

describe('collectSteerChains', () => {
  it('folds every steer turn into the host it interrupted', () => {
    const { byHost, hostOf } = collectSteerChains([
      msg('u1', 'user'),
      msg('g1', 'assistantGroup'),
      msg('s1', 'user', { steer: true }),
      msg('g2', 'assistantGroup'),
      msg('s2', 'user', { steer: true }),
      msg('a3', 'assistant'),
    ]);

    expect(byHost.get('g1')).toEqual({
      continuations: [
        { groupId: 'g2', steerUserId: 's1' },
        { groupId: 'a3', steerUserId: 's2' },
      ],
      hostId: 'g1',
      memberIds: ['g1', 's1', 'g2', 's2', 'a3'],
    });
    expect([...hostOf.entries()]).toEqual([
      ['s1', 'g1'],
      ['g2', 'g1'],
      ['s2', 'g1'],
      ['a3', 'g1'],
    ]);
  });

  it('indexes nothing for a plain conversation', () => {
    const { byHost, hostOf } = collectSteerChains([
      msg('u1', 'user'),
      msg('g1', 'assistantGroup'),
      msg('u2', 'user'),
      msg('g2', 'assistantGroup'),
    ]);

    expect(byHost.size).toBe(0);
    expect(hostOf.size).toBe(0);
  });

  it('leaves a steer message alone when nothing follows it or no host precedes it', () => {
    expect(
      collectSteerChains([
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
      ]).hostOf.size,
    ).toBe(0);

    expect(
      collectSteerChains([msg('s1', 'user', { steer: true }), msg('g1', 'assistantGroup')]).hostOf
        .size,
    ).toBe(0);

    expect(
      collectSteerChains([
        msg('a1', 'assistant'),
        msg('s1', 'user', { steer: true }),
        msg('g1', 'assistantGroup'),
      ]).hostOf.size,
    ).toBe(0);
  });

  it('breaks the chain at a regular user message', () => {
    const { hostOf } = collectSteerChains([
      msg('g1', 'assistantGroup'),
      msg('u2', 'user'),
      msg('g2', 'assistantGroup'),
      msg('s1', 'user', { steer: true }),
      msg('g3', 'assistantGroup'),
    ]);

    expect(hostOf.get('g3')).toBe('g2');
  });

  it('memoizes per messages array identity', () => {
    const messages = [msg('g1', 'assistantGroup')];

    expect(collectSteerChains(messages)).toBe(collectSteerChains(messages));
    expect(collectSteerChains([...messages])).not.toBe(collectSteerChains(messages));
  });
});
