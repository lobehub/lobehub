import { INBOX_SESSION_ID } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { liftInboxRow, withoutInboxInGroups } from './inboxRow';

const item = (id: string, extra: Partial<SidebarAgentItem> = {}): SidebarAgentItem =>
  ({
    id,
    pinned: false,
    title: id,
    type: 'agent',
    updatedAt: new Date('2026-01-01'),
    ...extra,
  }) as SidebarAgentItem;

const inbox = item('inbox-row', { slug: INBOX_SESSION_ID });

describe('liftInboxRow', () => {
  it('takes Lobe AI out of a pinned list so it can lead the sidebar', () => {
    const { inbox: lifted, lists } = liftInboxRow({
      defaultList: [item('a')],
      pinnedList: [item('p1'), inbox, item('p2')],
    });

    expect(lifted).toBe(inbox);
    expect(lists.pinnedList.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(lists.defaultList.map((i) => i.id)).toEqual(['a']);
  });

  it('leaves the lists untouched when Lobe AI is hidden or absent', () => {
    const { inbox: lifted, lists } = liftInboxRow({ defaultList: [item('a'), item('b')] });

    expect(lifted).toBeUndefined();
    expect(lists.defaultList.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('withoutInboxInGroups', () => {
  it('takes Lobe AI out of the folder it was moved into', () => {
    const { groups, inbox: lifted } = withoutInboxInGroups([
      { id: 'g1', items: [item('x')] },
      { id: 'g2', items: [inbox, item('y')] },
    ]);

    expect(lifted).toBe(inbox);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['x'], ['y']]);
  });
});
