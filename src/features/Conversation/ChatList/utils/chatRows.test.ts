import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildChatRows } from './chatRows';

const msg = (
  id: string,
  role: UIChatMessage['role'],
  metadata?: UIChatMessage['metadata'],
): UIChatMessage => ({ content: '', createdAt: 0, id, metadata, role, updatedAt: 0 }) as any;

describe('buildChatRows', () => {
  it('keeps a plain conversation flat', () => {
    const rows = buildChatRows(
      [
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('u2', 'user'),
        msg('g2', 'assistantGroup'),
      ],
      { isStreaming: false },
    );

    expect(rows).toEqual([{ id: 'u1' }, { id: 'g1' }, { id: 'u2' }, { id: 'g2' }]);
  });

  it('absorbs a steer turn into the previous group and hoists the steer message once settled', () => {
    const rows = buildChatRows(
      [
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
        msg('g2', 'assistantGroup'),
        msg('s2', 'user', { steer: true }),
        msg('a3', 'assistant'),
      ],
      { isStreaming: false },
    );

    expect(rows).toEqual([
      { id: 'u1' },
      { id: 's1' },
      { id: 's2' },
      {
        continuations: [
          { groupId: 'g2', steerUserId: 's1' },
          { groupId: 'a3', steerUserId: 's2' },
        ],
        id: 'g1',
        inlineSteer: false,
      },
    ]);
  });

  it('keeps steer bubbles inline while the latest chain is streaming', () => {
    const rows = buildChatRows(
      [
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
        msg('g2', 'assistantGroup'),
      ],
      { isStreaming: true },
    );

    expect(rows).toEqual([
      { id: 'u1' },
      { continuations: [{ groupId: 'g2', steerUserId: 's1' }], id: 'g1', inlineSteer: true },
    ]);
  });

  it('only hoists earlier chains while a later one streams', () => {
    const rows = buildChatRows(
      [
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
        msg('g2', 'assistantGroup'),
        msg('u2', 'user'),
        msg('g3', 'assistantGroup'),
        msg('s2', 'user', { steer: true }),
        msg('g4', 'assistantGroup'),
      ],
      { isStreaming: true },
    );

    expect(rows.map((row) => row.id)).toEqual(['u1', 's1', 'g1', 'u2', 'g3']);
    expect(rows[2]!.inlineSteer).toBe(false);
    expect(rows[4]!.inlineSteer).toBe(true);
  });

  it('leaves a steer message flat when nothing follows it or no group precedes it', () => {
    expect(
      buildChatRows(
        [msg('u1', 'user'), msg('g1', 'assistantGroup'), msg('s1', 'user', { steer: true })],
        {
          isStreaming: false,
        },
      ),
    ).toEqual([{ id: 'u1' }, { id: 'g1' }, { id: 's1' }]);

    expect(
      buildChatRows([msg('s1', 'user', { steer: true }), msg('g1', 'assistantGroup')], {
        isStreaming: false,
      }),
    ).toEqual([{ id: 's1' }, { id: 'g1' }]);
  });

  it('breaks the chain at a regular user message', () => {
    const rows = buildChatRows(
      [
        msg('u1', 'user'),
        msg('g1', 'assistantGroup'),
        msg('u2', 'user'),
        msg('g2', 'assistantGroup'),
        msg('s1', 'user', { steer: true }),
        msg('g3', 'assistantGroup'),
      ],
      { isStreaming: false },
    );

    expect(rows.map((row) => row.id)).toEqual(['u1', 'g1', 'u2', 's1', 'g2']);
  });
});
