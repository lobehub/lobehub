import { describe, expect, it } from 'vitest';

import { applyMailWrites, type MailWrite, pendingMailDeltas } from './mailWrites';

const row = (id: string) => ({ id, isStarred: false, isUnread: true });
const write = (
  ids: string[],
  patch: MailWrite['patch'],
  extra?: Partial<MailWrite>,
): MailWrite => ({
  accountId: 'a',
  draftDelta: 0,
  id: 1,
  ids,
  patch,
  unreadDelta: 0,
  ...extra,
});

describe('applyMailWrites', () => {
  it('layers a pending write over whatever the poll returned', () => {
    expect(applyMailWrites([row('1'), row('2')], [write(['1'], { isUnread: false })])).toEqual([
      { id: '1', isStarred: false, isUnread: false },
      row('2'),
    ]);
  });

  it('hides removed rows and lets the latest write win', () => {
    expect(
      applyMailWrites(
        [row('1'), row('2')],
        [
          write(['1'], { removed: true }),
          write(['2'], { isStarred: true }),
          write(['2'], { isStarred: false }),
        ],
      ),
    ).toEqual([row('2')]);
  });
});

describe('pendingMailDeltas', () => {
  it('counts only the address on screen', () => {
    expect(
      pendingMailDeltas(
        [
          write(['1'], {}, { unreadDelta: -2 }),
          write(['2'], {}, { accountId: 'b', unreadDelta: -5 }),
          write(['3'], {}, { draftDelta: -1 }),
        ],
        'a',
      ),
    ).toEqual({ drafts: -1, unread: -2 });
  });
});
