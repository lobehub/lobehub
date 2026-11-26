// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'plugin-modes-user';
const otherUserId = 'plugin-modes-other';

const insertAgent = (id: string, plugins: unknown, extra: Record<string, unknown> = {}) =>
  serverDB.insert(agents).values({ id, plugins: plugins as any, slug: id, userId, ...extra });

const pluginsOf = async (id: string) =>
  (await serverDB.query.agents.findFirst({ where: (t, { eq }) => eq(t.id, id) }))?.plugins;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentModel.listPluginModes', () => {
  it('finds both entry shapes and reports their mode', async () => {
    await insertAgent('a-legacy', ['pptx', 'web']);
    await insertAgent('a-pinned', [{ identifier: 'pptx' }]);
    await insertAgent('a-disabled', ['web', { identifier: 'pptx', mode: 'disabled' }]);
    await insertAgent('a-none', ['web']);
    await insertAgent('a-null', null);

    const model = new AgentModel(serverDB, userId);
    const result = await model.listPluginModes('pptx');

    expect(result.sort((a, b) => a.agentId.localeCompare(b.agentId))).toEqual([
      { agentId: 'a-disabled', mode: 'disabled' },
      { agentId: 'a-legacy', mode: 'pinned' },
      { agentId: 'a-pinned', mode: 'pinned' },
    ]);
  });

  it('skips other users, virtual and heterogeneous agents', async () => {
    await insertAgent('a-other', ['pptx'], { userId: otherUserId });
    await insertAgent('a-virtual', ['pptx'], { virtual: true });
    await insertAgent('a-hetero', ['pptx'], {
      agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
    });
    await insertAgent('a-mine', ['pptx'], { agencyConfig: {} });

    const model = new AgentModel(serverDB, userId);

    expect(await model.listPluginModes('pptx')).toEqual([{ agentId: 'a-mine', mode: 'pinned' }]);
  });
});

describe('AgentModel.setPluginMode', () => {
  it('pins by appending, and rewrites an existing entry in place', async () => {
    await insertAgent('a-empty', null);
    await insertAgent('a-legacy', ['web', 'pptx', 'search']);
    await insertAgent('a-object', [{ identifier: 'pptx', mode: 'pinned' }, 'web']);

    const model = new AgentModel(serverDB, userId);
    const rows = await model.setPluginMode('pptx', 'disabled', ['a-empty', 'a-legacy', 'a-object']);

    expect(rows).toHaveLength(3);
    expect(await pluginsOf('a-empty')).toEqual([{ identifier: 'pptx', mode: 'disabled' }]);
    expect(await pluginsOf('a-legacy')).toEqual([
      'web',
      { identifier: 'pptx', mode: 'disabled' },
      'search',
    ]);
    expect(await pluginsOf('a-object')).toEqual([{ identifier: 'pptx', mode: 'disabled' }, 'web']);
  });

  it('auto removes the entry and keeps the rest in order', async () => {
    await insertAgent('a-1', ['web', { identifier: 'pptx', mode: 'disabled' }, 'search']);
    await insertAgent('a-2', ['pptx']);

    const model = new AgentModel(serverDB, userId);
    await model.setPluginMode('pptx', 'auto', ['a-1', 'a-2']);

    expect(await pluginsOf('a-1')).toEqual(['web', 'search']);
    expect(await pluginsOf('a-2')).toEqual([]);
  });

  it('auto without agentIds removes it from every own agent carrying it, and only those', async () => {
    await insertAgent('a-1', ['pptx']);
    await insertAgent('a-2', [{ identifier: 'pptx', mode: 'disabled' }]);
    await insertAgent('a-3', ['web']);
    await insertAgent('a-other', ['pptx'], { userId: otherUserId });

    const model = new AgentModel(serverDB, userId);
    const rows = await model.setPluginMode('pptx', 'auto');

    expect(rows.map((row) => row.id).sort()).toEqual(['a-1', 'a-2']);
    expect(await pluginsOf('a-1')).toEqual([]);
    expect(await pluginsOf('a-2')).toEqual([]);
    expect(await pluginsOf('a-3')).toEqual(['web']);
    expect(await pluginsOf('a-other')).toEqual(['pptx']);
  });

  it("never writes another user's agent", async () => {
    await insertAgent('a-other', ['web'], { userId: otherUserId });

    const model = new AgentModel(serverDB, userId);
    const rows = await model.setPluginMode('pptx', 'pinned', ['a-other']);

    expect(rows).toEqual([]);
    expect(await pluginsOf('a-other')).toEqual(['web']);
  });
});
