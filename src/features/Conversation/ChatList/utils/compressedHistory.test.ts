import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  expandCompressedRows,
  findCompressedGroupToPage,
  getCompressedHistoryMembers,
} from './compressedHistory';

const msg = (id: string, role: string, extra: Partial<UIChatMessage> = {}) =>
  ({ content: id, id, role, ...extra }) as UIChatMessage;

const group = (extra: Partial<UIChatMessage> = {}) =>
  msg('group', 'compressedGroup', {
    compressedMessages: [
      // Flat state row a capped node keeps for runtime restores.
      msg('state-tool', 'tool'),
      msg('u1', 'user'),
      msg('a1', 'assistant'),
      // Mid-turn placeholder captured by the compression.
      msg('placeholder', 'assistant', { content: '...' }),
    ],
    ...extra,
  });

describe('getCompressedHistoryMembers', () => {
  it('keeps only rows the history renderer draws, older pages first', () => {
    const members = getCompressedHistoryMembers(group(), {
      messages: [msg('u0', 'user'), msg('a0', 'assistant')],
      omittedIds: [],
    });

    expect(members.map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
  });

  it('reuses the members of an unchanged group and page', () => {
    const node = group();
    const page = { messages: [msg('u0', 'user')], omittedIds: [] };

    const members = getCompressedHistoryMembers(node, page);

    expect(getCompressedHistoryMembers(node, page)).toBe(members);
    expect(getCompressedHistoryMembers(node, { ...page })).not.toBe(members);
  });
});

describe('expandCompressedRows', () => {
  it('lays the original conversation out as rows right above the group', () => {
    const messages = [group(), msg('u2', 'user'), msg('a2', 'assistant')];

    const result = expandCompressedRows(
      messages.map((m) => ({ id: m.id })),
      messages,
      {},
    );

    expect(result.rows.map((row) => row.id)).toEqual(['u1', 'a1', 'group', 'u2', 'a2']);
    expect(result.rows[0].compressedMember?.id).toBe('u1');
    expect(result.rows[2].compressedMember).toBeUndefined();
    // Deep links resolve a member id to its own row, not the group's.
    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'group', 'u2', 'a2']);
  });

  it('leaves a transcript without compression untouched', () => {
    const messages = [msg('u1', 'user')];
    const rows = [{ id: 'u1' }];

    expect(expandCompressedRows(rows, messages, {})).toEqual({ messages, rows });
  });
});

describe('findCompressedGroupToPage', () => {
  it('pages from the newest unloaded member when the group is the oldest row', () => {
    const capped = group({ compressedOmittedIds: ['o1', 'o2', 'state-tool'] });

    expect(findCompressedGroupToPage([capped, msg('u2', 'user')], {})).toEqual({
      group: capped,
      untilId: 'state-tool',
    });
    // A loaded page carries the ids still older than it.
    expect(
      findCompressedGroupToPage([capped], { group: { messages: [], omittedIds: ['o1'] } }),
    ).toEqual({ group: capped, untilId: 'o1' });
  });

  it('stops once every member is loaded or older transcript rows sit above', () => {
    const capped = group({ compressedOmittedIds: ['o1'] });

    expect(
      findCompressedGroupToPage([capped], { group: { messages: [], omittedIds: [] } }),
    ).toBeUndefined();
    expect(findCompressedGroupToPage([group()], {})).toBeUndefined();
    expect(findCompressedGroupToPage([msg('u0', 'user'), capped], {})).toBeUndefined();
  });
});
