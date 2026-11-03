// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'forked-from-test-user-id';
const agentModel = new AgentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.getAgentByForkedFromIdentifier with hidden copies', () => {
  it('keeps the hidden copy an @ mention runs apart from installed agents', async () => {
    const [hidden] = await serverDB
      .insert(agents)
      .values({
        userId,
        title: 'Mentioned',
        params: { forkedFromIdentifier: 'mentioned-id' },
        virtual: true,
      })
      .returning();

    expect(await agentModel.getAgentByForkedFromIdentifier('mentioned-id')).toBeNull();
    expect(await agentModel.getAgentByForkedFromIdentifier('mentioned-id', { virtual: true })).toBe(
      hidden.id,
    );
  });

  it('finds the installed agent, not the hidden copy, by default', async () => {
    const [installed] = await serverDB
      .insert(agents)
      .values([
        { userId, title: 'Hidden', params: { forkedFromIdentifier: 'both-id' }, virtual: true },
        { userId, title: 'Installed', params: { forkedFromIdentifier: 'both-id' } },
      ])
      .returning()
      .then((rows) => rows.filter((row) => !row.virtual));

    expect(await agentModel.getAgentByForkedFromIdentifier('both-id')).toBe(installed.id);
  });
});
