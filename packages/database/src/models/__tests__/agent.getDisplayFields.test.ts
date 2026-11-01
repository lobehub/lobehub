// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'display-fields-user-id';
const userId2 = 'display-fields-user-id-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.getAgentDisplayFields', () => {
  it('projects only the three display fields', async () => {
    await serverDB.insert(agents).values({
      avatar: '🐶',
      description: 'Should not be returned',
      id: 'agent-display',
      name: 'Coco',
      slug: 'agent-display',
      title: 'Product Assistant',
      userId,
    });

    const model = new AgentModel(serverDB, userId);
    const result = await model.getAgentDisplayFields('agent-display');

    // The point of the projection: a sender label must not drag the agent's
    // knowledge and file contents through `getAgentConfigById`.
    expect(result).toEqual({ avatar: '🐶', name: 'Coco', title: 'Product Assistant' });
  });

  it('returns null for a missing agent', async () => {
    const model = new AgentModel(serverDB, userId);

    await expect(model.getAgentDisplayFields('agent-nope')).resolves.toBeNull();
  });

  it("returns null for an agent outside the caller's scope", async () => {
    await serverDB.insert(agents).values({
      avatar: '👻',
      id: 'agent-other',
      name: 'Other',
      slug: 'agent-other',
      title: 'Other',
      userId: userId2,
    });

    const model = new AgentModel(serverDB, userId);

    await expect(model.getAgentDisplayFields('agent-other')).resolves.toBeNull();
  });
});
