// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const owner = 'tag-filter-owner';
const member = 'tag-filter-member';
let workspaceId = '';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: owner }, { id: member }]);
  const [ws] = await serverDB
    .insert(workspaces)
    .values({ name: 'tag-filter-ws', primaryOwnerId: owner, slug: 'tag-filter-ws' })
    .returning();
  workspaceId = ws.id;
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel queryAgents / countAgents — tag filter', () => {
  it('keeps only agents carrying the tag in a personal scope, and returns their tags', async () => {
    await serverDB.insert(agents).values([
      { id: 'pet-agent', tags: ['lobe-pet', 'cat'], title: 'Mimi', userId: owner },
      { id: 'plain-agent', tags: [], title: 'Writer', userId: owner },
      { id: 'other-tag-agent', tags: ['lobe-pet-x'], title: 'Near miss', userId: owner },
      { id: 'untagged-agent', title: 'Legacy', userId: owner },
    ]);
    const model = new AgentModel(serverDB, owner);

    const tagged = await model.queryAgents({ tag: 'lobe-pet' });
    expect(tagged.map((a) => a.id)).toEqual(['pet-agent']);
    expect(tagged[0].tags).toEqual(['lobe-pet', 'cat']);
    await expect(model.countAgents({ tag: 'lobe-pet' })).resolves.toBe(1);

    // without a tag nothing changes
    await expect(model.queryAgents()).resolves.toHaveLength(4);
    await expect(model.countAgents()).resolves.toBe(4);
  });

  it('applies the tag before the limit and leaves the inbox out', async () => {
    await serverDB.insert(agents).values([
      { id: 'inbox', slug: 'inbox', title: 'Lobe', userId: owner, virtual: true },
      {
        id: 'pet-old',
        tags: ['lobe-pet'],
        title: 'Old pet',
        updatedAt: new Date(1000),
        userId: owner,
      },
      { id: 'plain-new', tags: [], title: 'New plain', updatedAt: new Date(5000), userId: owner },
    ]);
    const model = new AgentModel(serverDB, owner);

    const result = await model.queryAgents({ includeInbox: true, limit: 1, tag: 'lobe-pet' });
    expect(result.map((a) => a.id)).toEqual(['pet-old']);
  });

  it('filters on an empty tag instead of treating it as no filter', async () => {
    await serverDB.insert(agents).values([
      { id: 'empty-tag', tags: [''], userId: owner },
      { id: 'plain', tags: ['a'], userId: owner },
    ]);
    const model = new AgentModel(serverDB, owner);

    expect((await model.queryAgents({ tag: '' })).map((a) => a.id)).toEqual(['empty-tag']);
    await expect(model.countAgents({ tag: '' })).resolves.toBe(1);
  });

  it('lists a member only the tagged agents the workspace already shows them', async () => {
    await serverDB.insert(agents).values([
      { id: 'ws-pet-public', tags: ['lobe-pet'], userId: owner, visibility: 'public', workspaceId },
      {
        id: 'ws-pet-private',
        tags: ['lobe-pet'],
        userId: owner,
        visibility: 'private',
        workspaceId,
      },
      { id: 'ws-crm', tags: [], userId: owner, visibility: 'public', workspaceId },
      {
        id: 'ws-member-pet',
        tags: ['lobe-pet'],
        userId: member,
        visibility: 'private',
        workspaceId,
      },
    ]);
    const model = new AgentModel(serverDB, member, workspaceId);

    const ids = (await model.queryAgents({ tag: 'lobe-pet' })).map((a) => a.id).sort();
    expect(ids).toEqual(['ws-member-pet', 'ws-pet-public']);
    await expect(model.countAgents({ tag: 'lobe-pet' })).resolves.toBe(2);
  });
});
