// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'reset-inbox-user';
const otherUserId = 'reset-inbox-other';

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(cleanup);

const readAgent = async (id: string) => {
  const [row] = await serverDB.select().from(agents).where(eq(agents.id, id));
  return row;
};

const customization = {
  avatar: '🏗️',
  backgroundColor: '#ff0000',
  chatConfig: { historyCount: 3 },
  description: 'Designs the Kolden architecture',
  editorData: { root: { children: [] } },
  fewShots: [{ content: 'hi', role: 'user' }],
  model: 'custom-model',
  name: 'Arquiteto',
  openingMessage: 'Olá',
  openingQuestions: ['Por onde começamos?'],
  params: { temperature: 0.2 },
  plugins: ['some-plugin'],
  profile: { traits: ['direct'] },
  provider: 'custom-provider',
  systemRole: 'You are an architect.',
  tags: ['architecture'],
  title: 'Arquiteto Kolden',
  tts: { voice: { openai: 'alloy' } },
} as const;

const customizeInbox = async (ownerId: string) => {
  const model = new AgentModel(serverDB, ownerId);
  const inbox = await model.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
  await serverDB
    .update(agents)
    .set({ ...(customization as any), pinned: true })
    .where(eq(agents.id, inbox!.id));
  return inbox!.id;
};

describe('AgentModel.resetInboxAgent', () => {
  it('restores the customized default assistant to its provisioned state', async () => {
    const model = new AgentModel(serverDB, userId);
    const pristine = await model.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
    const pristineRow = await readAgent(pristine!.id);
    const inboxId = await customizeInbox(userId);

    const result = await model.resetInboxAgent(inboxId);

    expect(result?.id).toBe(inboxId);
    const row = await readAgent(inboxId);
    expect(row).toMatchObject({
      avatar: pristineRow.avatar,
      backgroundColor: pristineRow.backgroundColor,
      chatConfig: pristineRow.chatConfig,
      description: pristineRow.description,
      editorData: pristineRow.editorData,
      fewShots: pristineRow.fewShots,
      model: pristineRow.model,
      name: pristineRow.name,
      openingMessage: pristineRow.openingMessage,
      openingQuestions: pristineRow.openingQuestions,
      params: pristineRow.params,
      plugins: pristineRow.plugins,
      profile: pristineRow.profile,
      provider: pristineRow.provider,
      systemRole: pristineRow.systemRole,
      tags: pristineRow.tags,
      title: pristineRow.title,
      tts: pristineRow.tts,
    });
  });

  it('keeps identity, placement and execution settings', async () => {
    const model = new AgentModel(serverDB, userId);
    const inboxId = await customizeInbox(userId);
    const before = await readAgent(inboxId);

    await model.resetInboxAgent(inboxId);

    const row = await readAgent(inboxId);
    expect(row).toMatchObject({
      agencyConfig: before.agencyConfig,
      id: inboxId,
      pinned: true,
      slug: BUILTIN_AGENT_SLUGS.inbox,
      userId,
      virtual: before.virtual,
    });
  });

  it('keeps the model selection when asked to', async () => {
    const model = new AgentModel(serverDB, userId);
    const inboxId = await customizeInbox(userId);

    await model.resetInboxAgent(inboxId, { keepModel: true });

    const row = await readAgent(inboxId);
    expect(row).toMatchObject({
      model: customization.model,
      provider: customization.provider,
      systemRole: null,
      title: null,
    });
  });

  it('refuses an agent that is not the default assistant', async () => {
    const model = new AgentModel(serverDB, userId);
    const { id } = await model.create({ systemRole: 'keep me', title: 'Custom agent' });

    const result = await model.resetInboxAgent(id);

    expect(result).toBeNull();
    expect(await readAgent(id)).toMatchObject({ systemRole: 'keep me', title: 'Custom agent' });
  });

  it("does not touch another user's default assistant", async () => {
    const otherInboxId = await customizeInbox(otherUserId);

    const result = await new AgentModel(serverDB, userId).resetInboxAgent(otherInboxId);

    expect(result).toBeNull();
    expect(await readAgent(otherInboxId)).toMatchObject({
      systemRole: customization.systemRole,
      title: customization.title,
    });
  });
});
