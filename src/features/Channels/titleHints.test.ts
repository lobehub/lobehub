import type { ChannelAvatarMember } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { duplicateTitleHints } from './titleHints';

const member = (name: string | null): ChannelAvatarMember => ({
  actorType: 'agent',
  avatar: null,
  backgroundColor: null,
  id: `agt_${name}`,
  name,
});

const channel = (
  id: string,
  title: string,
  members: Array<string | null> = [],
  createdAt = '2026-11-20T08:00:00Z',
) => ({ createdAt: new Date(createdAt), id, memberAvatars: members.map(member), title });

const format = { locale: 'en-US', separator: ', ' };

describe('duplicateTitleHints', () => {
  it('gives no hint to a Channel whose name is its own', () => {
    const hints = duplicateTitleHints(
      [channel('a', 'General', ['Lobot']), channel('b', 'Design', ['Lobot'])],
      format,
    );

    expect(hints.size).toBe(0);
  });

  it('names the other members when that tells same-named Channels apart', () => {
    const hints = duplicateTitleHints(
      [
        channel('a', 'General', ['Lobot']),
        channel('b', 'General ', ['Datum design agent', 'Codex', 'Sienna']),
        channel('c', 'Design', ['Lobot']),
      ],
      format,
    );

    expect(Object.fromEntries(hints)).toEqual({ a: 'Lobot', b: 'Datum design agent, Codex' });
  });

  it('falls back to the creation day for rows whose members another row shares', () => {
    const hints = duplicateTitleHints(
      [
        channel('a', 'General', ['Lobot'], '2026-11-18T08:00:00Z'),
        channel('b', 'General', ['LobeAI'], '2026-11-20T08:00:00Z'),
        channel('c', 'General', ['LobeAI'], '2026-11-24T08:00:00Z'),
        channel('d', 'General', [null], '2026-10-02T08:00:00Z'),
      ],
      format,
    );

    expect(Object.fromEntries(hints)).toEqual({
      a: 'Lobot',
      b: 'Nov 20, 2026',
      c: 'Nov 24, 2026',
      d: 'Oct 2, 2026',
    });
  });

  it('adds the time when Channels were created the same day', () => {
    const hints = duplicateTitleHints(
      [
        channel('a', 'General', ['LobeAI'], '2026-11-20T08:00:00Z'),
        channel('b', 'General', ['LobeAI'], '2026-11-20T09:30:00Z'),
      ],
      format,
    );

    expect(hints.get('a')).not.toBe(hints.get('b'));
    expect(hints.get('a')).toMatch(/^Nov 20, 2026, \d{1,2}:\d{2}/);
  });
});
