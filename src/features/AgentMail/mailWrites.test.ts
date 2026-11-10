import { describe, expect, it } from 'vitest';

import { applyMailWrites, type MailWrite, pendingMailDeltas, queueRowWrite } from './mailWrites';

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

describe('queueRowWrite', () => {
  it('sends a later write to the same row only after the earlier one settles', async () => {
    const order: string[] = [];
    let finishStar!: () => void;
    const star = queueRowWrite(['m1'], async () => {
      order.push('star:sent');
      await new Promise<void>((resolve) => {
        finishStar = resolve;
      });
      order.push('star:done');
    });
    const unstar = queueRowWrite(['m1'], async () => {
      order.push('unstar:sent');
    });
    const other = queueRowWrite(['m2'], async () => {
      order.push('other:sent');
    });

    await other;
    expect(order).toEqual(['star:sent', 'other:sent']);

    finishStar();
    await Promise.all([star, unstar]);
    expect(order).toEqual(['star:sent', 'other:sent', 'star:done', 'unstar:sent']);
  });

  it('still sends the later write when the earlier one fails', async () => {
    const failing = queueRowWrite(['m3'], async () => {
      throw new Error('down');
    });
    const next = queueRowWrite(['m3'], async () => 'sent');

    await expect(failing).rejects.toThrow('down');
    await expect(next).resolves.toBe('sent');
  });
});
