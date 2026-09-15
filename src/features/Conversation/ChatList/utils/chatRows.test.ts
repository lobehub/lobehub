import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildChatRows } from './chatRows';

const msg = (
  id: string,
  role: UIChatMessage['role'],
  metadata?: UIChatMessage['metadata'],
): UIChatMessage => ({ content: '', createdAt: 0, id, metadata, role, updatedAt: 0 }) as any;

const steered = [
  msg('u1', 'user'),
  msg('g1', 'assistantGroup'),
  msg('s1', 'user', { steer: true }),
  msg('g2', 'assistantGroup'),
  msg('s2', 'user', { steer: true }),
  msg('a3', 'assistant'),
];

describe('buildChatRows', () => {
  it('keeps a plain conversation flat', () => {
    const rows = buildChatRows([
      msg('u1', 'user'),
      msg('g1', 'assistantGroup'),
      msg('u2', 'user'),
      msg('g2', 'assistantGroup'),
    ]);

    expect(rows).toEqual([{ id: 'u1' }, { id: 'g1' }, { id: 'u2' }, { id: 'g2' }]);
  });

  it('folds steer turns into the host row and never lifts the steer messages out', () => {
    expect(buildChatRows(steered)).toEqual([
      { id: 'u1' },
      {
        continuations: [
          { groupId: 'g2', steerUserId: 's1' },
          { groupId: 'a3', steerUserId: 's2' },
        ],
        id: 'g1',
      },
    ]);
  });

  it('is a pure function of the messages', () => {
    expect(buildChatRows(steered)).toEqual(buildChatRows([...steered]));
  });

  it('leaves a steer message flat when nothing follows it or no group precedes it', () => {
    expect(
      buildChatRows([
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
      ]),
    ).toEqual([{ id: 'u1' }, { id: 'g1' }, { id: 's1' }]);

    expect(
      buildChatRows([msg('s1', 'user', { steer: true }), msg('g1', 'assistantGroup')]),
    ).toEqual([{ id: 's1' }, { id: 'g1' }]);
  });

  it('breaks the chain at a regular user message', () => {
    const rows = buildChatRows([
      msg('u1', 'user'),
      msg('g1', 'assistantGroup'),
      msg('u2', 'user'),
      msg('g2', 'assistantGroup'),
      msg('s1', 'user', { steer: true }),
      msg('g3', 'assistantGroup'),
    ]);

    expect(rows.map((row) => row.id)).toEqual(['u1', 'g1', 'u2', 'g2']);
  });
});
