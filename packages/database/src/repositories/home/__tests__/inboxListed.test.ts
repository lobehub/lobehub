// Regression (T-14752): the default inbox agent (LobeAI) is a `virtual` row, and
// the sidebar list used to drop every virtual row — so once a user hid Lobe AI
// from the sidebar, nothing listed it again. The scope's inbox is now an
// ordinary list item; other virtual rows and other scopes' inboxes stay out.
import { DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import * as Schema from '../../../schemas';
import { HomeRepository } from '../index';

const clientDB = await getTestDB();

const memberA = 'u-inbox-a';
const memberB = 'u-inbox-b';
const ws = 'ws-inbox-listed';

const ids = (items: { id: string }[]) => items.map((item) => item.id);

beforeEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
  await clientDB.insert(Schema.users).values([{ id: memberA }, { id: memberB }]);
  await clientDB.insert(Schema.workspaces).values({
    id: ws,
    name: 'WS',
    primaryOwnerId: memberA,
    slug: ws,
  });
});

afterEach(async () => {
  await clientDB.delete(Schema.users);
  await clientDB.delete(Schema.workspaces);
});

describe('inbox agent in the sidebar list', () => {
  it('lists the personal inbox first, with its default title, and keeps other virtual rows out', async () => {
    await clientDB.insert(Schema.agents).values([
      {
        id: 'a-inbox',
        slug: INBOX_SESSION_ID,
        updatedAt: new Date('2020-01-01'),
        userId: memberA,
        virtual: true,
      },
      { id: 'a-recent', title: 'Recent Agent', updatedAt: new Date('2026-01-01'), userId: memberA },
      { id: 'a-supervisor', title: 'Supervisor', userId: memberA, virtual: true },
    ]);

    const result = await new HomeRepository(clientDB, memberA).getSidebarAgentList(
      true,
      true,
      true,
    );

    expect(ids(result.ungrouped)).toEqual(['a-inbox', 'a-recent']);
    expect(result.ungrouped[0]).toMatchObject({
      slug: INBOX_SESSION_ID,
      title: DEFAULT_INBOX_TITLE,
    });
  });

  it('follows the inbox into the pinned bucket when the user pins it', async () => {
    await clientDB.insert(Schema.agents).values({
      id: 'a-inbox',
      pinned: true,
      slug: INBOX_SESSION_ID,
      userId: memberA,
      virtual: true,
    });

    const result = await new HomeRepository(clientDB, memberA).getSidebarAgentList(
      true,
      true,
      true,
    );

    expect(ids(result.pinned)).toEqual(['a-inbox']);
    expect(ids(result.ungrouped)).toEqual([]);
  });

  it("shares the workspace's single inbox with every member, and only that workspace's", async () => {
    await clientDB.insert(Schema.workspaces).values({
      id: 'ws-other',
      name: 'Other',
      primaryOwnerId: memberB,
      slug: 'ws-other',
    });
    await clientDB.insert(Schema.agents).values([
      { id: 'ws-inbox', slug: INBOX_SESSION_ID, userId: memberA, virtual: true, workspaceId: ws },
      {
        id: 'other-inbox',
        slug: INBOX_SESSION_ID,
        userId: memberB,
        virtual: true,
        workspaceId: 'ws-other',
      },
      { id: 'personal-inbox', slug: INBOX_SESSION_ID, userId: memberB, virtual: true },
    ]);

    for (const member of [memberA, memberB]) {
      const view = await new HomeRepository(clientDB, member, ws).getSidebarAgentList(
        true,
        true,
        true,
      );
      expect(ids(view.ungrouped)).toEqual(['ws-inbox']);
    }
  });

  it('keeps the inbox out for callers that do not ask for it (released clients)', async () => {
    await clientDB.insert(Schema.agents).values([
      { id: 'a-inbox', slug: INBOX_SESSION_ID, userId: memberA, virtual: true },
      { id: 'a-plain', title: 'Plain Agent', userId: memberA },
    ]);

    const result = await new HomeRepository(clientDB, memberA).getSidebarAgentList();

    expect(ids(result.ungrouped)).toEqual(['a-plain']);
  });
});
