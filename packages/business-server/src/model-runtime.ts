import { AgentRuntimeError, type ModelRuntimeHooks } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { userSettings, workspaces } from '@/database/schemas';
import type { LobeChatDatabase, Transaction } from '@/database/type';

const STARTER_CREDITS = 100_000;

const createInsufficientQuotaError = (workspaceId?: string) =>
  AgentRuntimeError.createError(AgentRuntimeErrorType.InsufficientQuota, {
    error: {
      message: workspaceId
        ? 'В workspace закончились токены. Пополните баланс в настройках workspace.'
        : 'В личном аккаунте закончились токены. Обратитесь к super-admin или пополните баланс.',
    },
  });

const createFrozenWorkspaceError = (reason?: string | null) =>
  AgentRuntimeError.createError(AgentRuntimeErrorType.ProviderBizError, {
    error: {
      message: reason
        ? `Workspace заморожен: ${reason}`
        : 'Workspace заморожен. Обратитесь к администратору.',
    },
  });

const getUsageTokens = (usage?: { totalTokens?: number; total_tokens?: number }) => {
  const tokens = Number(usage?.totalTokens ?? usage?.total_tokens ?? 0);

  if (!Number.isFinite(tokens)) return 0;

  return Math.max(0, Math.ceil(tokens));
};

const getCreditBalance = (value: unknown) => {
  const balance = Number(value ?? 0);

  if (!Number.isFinite(balance)) return 0;

  return Math.max(0, balance);
};

type BusinessRuntimeDatabase = LobeChatDatabase | Transaction;

const ensurePersonalMarket = async (db: BusinessRuntimeDatabase, userId: string) => {
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

const ensureWorkspaceSettings = async (db: BusinessRuntimeDatabase, workspaceId: string) => {
  const workspace = await db.query.workspaces.findFirst({
    columns: { frozen: true, frozenReason: true, settings: true },
    where: eq(workspaces.id, workspaceId),
  });

  if (!workspace) throw new Error('Workspace not found');
  if (workspace.frozen) throw createFrozenWorkspaceError(workspace.frozenReason);

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
    throw createInsufficientQuotaError(workspaceId);
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
    const wasUsageOverBalance = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .select({
          frozen: workspaces.frozen,
          frozenReason: workspaces.frozenReason,
          settings: workspaces.settings,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .for('update');

      if (!workspace) throw new Error('Workspace not found');
      if (workspace.frozen) throw createFrozenWorkspaceError(workspace.frozenReason);

      const settings = (workspace.settings as Record<string, unknown> | null) ?? {};
      const current = getCreditBalance(settings.creditBalance);
      const chargedTokens = Math.min(current, tokens);
      const balance = current - chargedTokens;

      await tx
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
                amount: -chargedTokens,
                at: new Date().toISOString(),
                balanceAfter: balance,
                type: 'llm_usage',
              },
            ],
          },
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));

      return chargedTokens < tokens;
    });

    if (wasUsageOverBalance) throw createInsufficientQuotaError(workspaceId);
    return;
  }

  const wasUsageOverBalance = await db.transaction(async (tx) => {
    await ensurePersonalMarket(tx, userId);

    const [row] = await tx
      .select({ market: userSettings.market })
      .from(userSettings)
      .where(eq(userSettings.id, userId))
      .for('update');

    const market = (row?.market as Record<string, unknown> | null) ?? {};
    const current = getCreditBalance(market.personalCreditBalance);
    const chargedTokens = Math.min(current, tokens);
    const balance = current - chargedTokens;

    await tx
      .update(userSettings)
      .set({
        market: {
          ...market,
          personalCreditBalance: balance,
          personalCreditCurrency: 'tokens',
          personalCreditInitialized: true,
          personalCreditLedger: [
            ...(Array.isArray(market.personalCreditLedger) ? market.personalCreditLedger : []),
            {
              amount: -chargedTokens,
              at: new Date().toISOString(),
              balanceAfter: balance,
              type: 'llm_usage',
            },
          ],
        },
      })
      .where(eq(userSettings.id, userId));

    return chargedTokens < tokens;
  });

  if (wasUsageOverBalance) throw createInsufficientQuotaError();
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
