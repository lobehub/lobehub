// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users, userSettings, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { getBusinessModelRuntimeHooks } from './model-runtime';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'business-runtime-user';
const workspaceId = 'business-runtime-workspace';

const cleanup = async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(userSettings);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await cleanup();
});

describe('getBusinessModelRuntimeHooks', () => {
  it('rejects workspace runtime calls when the workspace is frozen', async () => {
    await serverDB.insert(workspaces).values({
      frozen: true,
      frozenReason: 'risk control',
      id: workspaceId,
      name: 'Frozen workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });

    const hooks = getBusinessModelRuntimeHooks(serverDB, userId, 'openai', workspaceId);

    await expect(hooks.beforeChat?.()).rejects.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('risk control') }),
    });
  });

  it('depletes workspace credits when final usage exceeds the balance', async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Limited workspace',
      primaryOwnerId: userId,
      settings: { creditBalance: 5, creditInitialized: true, creditLedger: [] },
      slug: workspaceId,
    });

    const hooks = getBusinessModelRuntimeHooks(serverDB, userId, 'openai', workspaceId);

    await expect(hooks.onChatFinal?.({ usage: { totalTokens: 6 } } as never)).rejects.toMatchObject(
      {
        error: expect.objectContaining({ message: expect.stringContaining('закончились токены') }),
      },
    );

    const workspace = await serverDB.query.workspaces.findFirst({
      columns: { settings: true },
      where: eq(workspaces.id, workspaceId),
    });
    expect(workspace?.settings).toMatchObject({
      creditBalance: 0,
      creditLedger: [expect.objectContaining({ amount: -5, balanceAfter: 0 })],
    });

    await expect(hooks.beforeChat?.()).rejects.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('закончились токены') }),
    });
  });

  it('depletes personal credits when final usage exceeds the balance', async () => {
    await serverDB.insert(userSettings).values({
      id: userId,
      market: {
        personalCreditBalance: 3,
        personalCreditInitialized: true,
        personalCreditLedger: [],
      },
    });

    const hooks = getBusinessModelRuntimeHooks(serverDB, userId, 'openai');

    await expect(hooks.onChatFinal?.({ usage: { totalTokens: 8 } } as never)).rejects.toMatchObject(
      {
        error: expect.objectContaining({ message: expect.stringContaining('закончились токены') }),
      },
    );

    const settings = await serverDB.query.userSettings.findFirst({
      columns: { market: true },
      where: eq(userSettings.id, userId),
    });
    expect(settings?.market).toMatchObject({
      personalCreditBalance: 0,
      personalCreditLedger: [expect.objectContaining({ amount: -3, balanceAfter: 0 })],
    });

    await expect(hooks.beforeEmbeddings?.()).rejects.toMatchObject({
      error: expect.objectContaining({ message: expect.stringContaining('закончились токены') }),
    });
  });

  it('atomically debits personal credits and records one consistent ledger item', async () => {
    await serverDB.insert(userSettings).values({
      id: userId,
      market: {
        personalCreditBalance: 10,
        personalCreditInitialized: true,
        personalCreditLedger: [],
      },
    });

    const hooks = getBusinessModelRuntimeHooks(serverDB, userId, 'openai');
    await hooks.onEmbeddingsFinal?.({ usage: { total_tokens: 4 } } as never);

    const settings = await serverDB.query.userSettings.findFirst({
      columns: { market: true },
      where: eq(userSettings.id, userId),
    });
    expect(settings?.market).toMatchObject({
      personalCreditBalance: 6,
      personalCreditLedger: [expect.objectContaining({ amount: -4, balanceAfter: 6 })],
    });
  });
});
