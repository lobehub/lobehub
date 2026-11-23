// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'plugin-auto-skip-user';

const insertAgent = (id: string, plugins: unknown) =>
  serverDB.insert(agents).values({ id, plugins: plugins as any, slug: id, userId });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.listPluginModes · explicit auto entries', () => {
  it('drops an agent whose stored entry is explicitly auto, like an absent one', async () => {
    await insertAgent('a-auto', [{ identifier: 'pptx', mode: 'auto' }]);
    await insertAgent('a-pinned', [{ identifier: 'pptx', mode: 'pinned' }]);

    const model = new AgentModel(serverDB, userId);

    expect(await model.listPluginModes('pptx')).toEqual([{ agentId: 'a-pinned', mode: 'pinned' }]);
  });
});

describe('AgentModel.setPluginMode · caller-side guards', () => {
  it('returns an empty list for an explicitly empty agent set without touching any row', async () => {
    await insertAgent('a-pinned', [{ identifier: 'pptx', mode: 'pinned' }]);

    const model = new AgentModel(serverDB, userId);

    await expect(model.setPluginMode('pptx', 'disabled', [])).resolves.toEqual([]);

    const row = await serverDB.query.agents.findFirst({
      where: (t, { eq }) => eq(t.id, 'a-pinned'),
    });
    expect(row?.plugins).toEqual([{ identifier: 'pptx', mode: 'pinned' }]);
  });

  it('refuses a non-auto mode without an agent set', async () => {
    const model = new AgentModel(serverDB, userId);

    await expect(model.setPluginMode('pptx', 'pinned')).rejects.toThrow(
      'setPluginMode: agentIds is required',
    );
  });
});
