// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, chatGroupsAgents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ChatGroupModel } from '../chatGroup';

const userId = 'chat-group-supervisor-user';
const groupId = 'chat-group-supervisor-group';

const serverDB: LobeChatDatabase = await getTestDB();
const model = new ChatGroupModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(chatGroups).values({ id: groupId, title: 'Group', userId });
  await serverDB.insert(agents).values([
    { id: 'standalone-member', title: 'Standalone', userId, virtual: false },
    { id: 'group-built-member', title: 'Group built', userId, virtual: true },
  ]);
  await serverDB.insert(chatGroupsAgents).values([
    { agentId: 'standalone-member', chatGroupId: groupId, order: 0, role: 'participant', userId },
    { agentId: 'group-built-member', chatGroupId: groupId, order: 1, role: 'participant', userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ChatGroupModel.updateAgentInGroup supervisor promotion', () => {
  it('refuses to promote a referenced member to supervisor', async () => {
    await expect(
      model.updateAgentInGroup(groupId, 'standalone-member', { role: 'supervisor' }),
    ).rejects.toThrow('Only a group-owned member can act as the group supervisor');
  });

  it('promotes a group-owned member to supervisor', async () => {
    const result = await model.updateAgentInGroup(groupId, 'group-built-member', {
      role: 'supervisor',
    });

    expect(result).toMatchObject({ agentId: 'group-built-member', role: 'supervisor' });
  });
});
