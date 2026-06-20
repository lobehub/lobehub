import { AgentRuntimeError, type ModelRuntimeHooks } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { userSettings, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

const STARTER_CREDITS = 100_000;

const getUsageTokens = (usage?: { totalTokens?: number; total_tokens?: number }) =>
  Math.max(0, Math.ceil(Number(usage?.totalTokens ?? usage?.total_tokens ?? 0)));

const ensurePersonalMarket = async (db: LobeChatDatabase, userId: string) => {
  const row = await db.query.userSettings.findFirst({
    columns: { market: true },
    where: eq(userSettings.id, userId),
  });
  const market = (row?.market as Record<string, unknown> | null) ?? {};

  if (market.personalCreditInitialized) return market;

  const nextMarket = {
    ...market,
    personalCreditBalance: STARTER_CREDITS,
    personalCreditCurrency: 'tokens',
    personalCreditInitialized: true,
    personalCreditLedger: [
      ...(Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : []),
      {
        amount: STARTER_CREDITS,
        at: new Date().toISOString(),
        balanceAfter: STARTER_CREDITS,
        type: 'starter_grant',
      },
    ],
  };

  await db
    .insert(userSettings)
    .values({ id: userId, market: nextMarket })
    .onConflictDoUpdate({ set: { market: nextMarket }, target: userSettings.id });

  return nextMarket;
};

const ensureWorkspaceSettings = async (db: LobeChatDatabase, workspaceId: string) => {
  const workspace = await db.query.workspaces.findFirst({
    columns: { settings: true },
    where: eq(workspaces.id, workspaceId),
  });
  const settings = (workspace?.settings as Record<string, unknown> | null) ?? {};

  if (settings.creditInitialized) return settings;

  const nextSettings = {
    ...settings,
    creditBalance: STARTER_CREDITS,
    creditCurrency: 'tokens',
    creditInitialized: true,
    creditLedger: [
      ...(Array.isArray(settings.creditLedger) ? settings.creditLedger : []),
      {
        amount: STARTER_CREDITS,
        at: new Date().toISOString(),
        balanceAfter: STARTER_CREDITS,
        type: 'starter_grant',
      },
    ],
  };

  await db
    .update(workspaces)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  return nextSettings;
};

const assertPositiveBalance = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
) => {
  const balance = workspaceId
    ? Number((await ensureWorkspaceSettings(db, workspaceId)).creditBalance ?? 0)
    : Number((await ensurePersonalMarket(db, userId)).personalCreditBalance ?? 0);

  if (balance <= 0) {
    throw AgentRuntimeError.createError(AgentRuntimeErrorType.InsufficientQuota, {
      error: {
        message: workspaceId
          ? 'В workspace закончились токены. Пополните баланс в настройках workspace.'
          : 'В личном аккаунте закончились токены. Обратитесь к super-admin или пополните баланс.',
      },
    });
  }
};

const debitTokens = async (
  db: LobeChatDatabase,
  userId: string,
  tokens: number,
  workspaceId?: string,
) => {
  if (tokens <= 0) return;

  if (workspaceId) {
    const settings = await ensureWorkspaceSettings(db, workspaceId);
    const current = Number(settings.creditBalance ?? 0);
    const balance = Math.max(0, current - tokens);
    await db
      .update(workspaces)
      .set({
        settings: {
          ...settings,
          creditBalance: balance,
          creditCurrency: 'tokens',
          creditInitialized: true,
          creditLedger: [
            ...(Array.isArray(settings.creditLedger) ? settings.creditLedger : []),
            {
              amount: -tokens,
              at: new Date().toISOString(),
              balanceAfter: balance,
              type: 'llm_usage',
            },
          ],
        },
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspaceId));
    return;
  }

  const market = await ensurePersonalMarket(db, userId);
  const current = Number(market.personalCreditBalance ?? 0);
  const balance = Math.max(0, current - tokens);
  await db
    .insert(userSettings)
    .values({
      id: userId,
      market: {
        ...market,
        personalCreditBalance: balance,
        personalCreditCurrency: 'tokens',
        personalCreditInitialized: true,
        personalCreditLedger: [
          ...(Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : []),
          {
            amount: -tokens,
            at: new Date().toISOString(),
            balanceAfter: balance,
            type: 'llm_usage',
          },
        ],
      },
    })
    .onConflictDoUpdate({
      set: {
        market: {
          ...market,
          personalCreditBalance: balance,
          personalCreditCurrency: 'tokens',
          personalCreditInitialized: true,
          personalCreditLedger: [
            ...(Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : []),
            {
              amount: -tokens,
              at: new Date().toISOString(),
              balanceAfter: balance,
              type: 'llm_usage',
            },
          ],
        },
      },
      target: userSettings.id,
    });
};

export function getBusinessModelRuntimeHooks(
  db: LobeChatDatabase,
  userId: string,
  _provider: string,
  workspaceId?: string,
): ModelRuntimeHooks {
  return {
    beforeChat: async () => {
      await assertPositiveBalance(db, userId, workspaceId);
    },
    beforeEmbeddings: async () => {
      await assertPositiveBalance(db, userId, workspaceId);
    },
    onChatFinal: async (data) => {
      await debitTokens(db, userId, getUsageTokens(data.usage), workspaceId);
    },
    onEmbeddingsFinal: async (data) => {
      await debitTokens(db, userId, getUsageTokens(data.usage), workspaceId);
    },
  };
}
