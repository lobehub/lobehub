// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'avatar-test-user-id';
const userId2 = 'avatar-test-user-id-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.getAgentAvatarsByIds', () => {
  it('should return empty array for empty input', async () => {
    const model = new AgentModel(serverDB, userId);
    const result = await model.getAgentAvatarsByIds([]);
    expect(result).toEqual([]);
  });

  it('should return agent avatar info by IDs', async () => {
    await serverDB.insert(agents).values([
      {
        avatar: '🤖',
        backgroundColor: '#ff0000',
        id: 'agent-av-1',
        slug: 'agent-av-1',
        title: 'Agent One',
        userId,
      },
      {
        avatar: '🧠',
        backgroundColor: '#00ff00',
        id: 'agent-av-2',
        slug: 'agent-av-2',
        title: 'Agent Two',
        userId,
      },
    ]);

    const model = new AgentModel(serverDB, userId);
    const result = await model.getAgentAvatarsByIds(['agent-av-1', 'agent-av-2']);

    expect(result).toHaveLength(2);
    const agent1 = result.find((a) => a.id === 'agent-av-1');
    expect(agent1).toEqual({
      avatar: '🤖',
      backgroundColor: '#ff0000',
      id: 'agent-av-1',
      title: 'Agent One',
    });
  });

  it('should only return agents owned by the current user', async () => {
    await serverDB.insert(agents).values([
      { avatar: '🤖', id: 'agent-mine', slug: 'agent-mine', title: 'Mine', userId },
      { avatar: '👻', id: 'agent-other', slug: 'agent-other', title: 'Other', userId: userId2 },
    ]);

    const model = new AgentModel(serverDB, userId);
    const result = await model.getAgentAvatarsByIds(['agent-mine', 'agent-other']);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('agent-mine');
  });

  it('should return only selected fields', async () => {
    await serverDB.insert(agents).values({
      avatar: '🤖',
      backgroundColor: '#000',
      description: 'Should not be returned',
      id: 'agent-fields',
      slug: 'agent-fields',
      title: 'Test Agent',
      userId,
    });

    const model = new AgentModel(serverDB, userId);
    const result = await model.getAgentAvatarsByIds(['agent-fields']);

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual(['avatar', 'backgroundColor', 'id', 'title']);
  });
});
