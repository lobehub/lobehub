/**
 * TRPC adapters for the Message tool executor.
 *
 * Implements the `BotProviderQuery` and `MessageRuntimeService` interfaces
 * from `@lobechat/builtin-tool-message/executionRuntime` by routing every
 * call through `lambdaClient.*`. This lets the frontend reuse the runtime's
 * orchestration + formatting logic instead of duplicating it.
 */
import type {
  BotProviderQuery,
  MessageRuntimeService,
} from '@lobechat/builtin-tool-message/executionRuntime';

import { lambdaClient } from '@/libs/trpc/client';

// ────────────────────────────────────────────────────────────────────────
// Bot provider — discovery + lifecycle (per-agent bots & messenger installs)
// ────────────────────────────────────────────────────────────────────────

export const trpcBotProvider: BotProviderQuery = {
  listPlatforms: async () => {
    const platforms = (await lambdaClient.agentBotProvider.listPlatforms.query()) as any[];
    // The server returns raw serialized platforms whose credential fields
    // are nested under `schema[].properties`. Flatten to the runtime's
    // `PlatformInfo.credentialFields` shape (same transform the server-side
    // BotProviderQuery does — see `serverRuntimes/message/index.ts`).
    return platforms.map((p) => {
      const credSchema = (p.schema ?? []).find((f: any) => f.key === 'credentials' && f.properties);
      const credFields = (credSchema?.properties ?? []) as any[];
      return {
        credentialFields: credFields.map((f: any) => ({
          key: f.key,
          label: f.label ?? f.key,
          required: !!f.required,
          type: f.type ?? 'string',
        })),
        id: p.id,
        name: p.name,
      };
    });
  },

  listBots: async () => {
    // The runtime's `listBots` is agent-scoped; on the frontend the scope
    // comes from the active context. We use the unscoped `list` query
    // (it returns the caller's bots) — the runtime caller is expected to
    // narrow by agentId itself (mirror of server behavior where the
    // factory pulls `context.agentId`). For now we surface every bot the
    // caller owns; agent filtering happens upstream in the LLM prompt.
    const providers = (await lambdaClient.agentBotProvider.list.query()) as any[];
    return providers.map((p) => ({
      applicationId: p.applicationId,
      enabled: p.enabled,
      id: p.id,
      platform: p.platform,
      runtimeStatus: p.runtimeStatus,
      // Settings nests serverId/userId — the runtime interface expects
      // them flat. Map both back up so the formatter can render them.
      serverId: (p.settings as Record<string, unknown> | null)?.serverId as string | undefined,
      userId: (p.settings as Record<string, unknown> | null)?.userId as string | undefined,
    }));
  },

  getBotDetail: async (botId) => {
    const providers = (await lambdaClient.agentBotProvider.list.query()) as any[];
    const bot = providers.find((b) => b.id === botId);
    if (!bot) return null;
    return {
      applicationId: bot.applicationId,
      enabled: bot.enabled,
      id: bot.id,
      platform: bot.platform,
      runtimeStatus: bot.runtimeStatus,
      settings: (bot.settings as Record<string, unknown>) ?? undefined,
    };
  },

  createBot: async (params) => {
    const result = (await lambdaClient.agentBotProvider.create.mutate({
      agentId: params.agentId,
      applicationId: params.applicationId,
      credentials: params.credentials,
      platform: params.platform,
      settings: params.settings,
    })) as { id: string };
    return { id: result.id, platform: params.platform };
  },

  updateBot: async (botId, params) => {
    await lambdaClient.agentBotProvider.update.mutate({
      id: botId,
      credentials: params.credentials,
      settings: params.settings,
    });
  },

  deleteBot: async (botId) => {
    await lambdaClient.agentBotProvider.delete.mutate({ id: botId });
  },

  toggleBot: async (botId, enabled) => {
    await lambdaClient.agentBotProvider.update.mutate({ id: botId, enabled });
  },

  connectBot: async (botId) => {
    // The TRPC connectBot endpoint keys on `{ applicationId, platform }`
    // rather than `botId`, so we resolve those from the bot list first.
    // Two round-trips, but the alternative is changing the server contract
    // — out of scope for the unification refactor.
    const providers = (await lambdaClient.agentBotProvider.list.query()) as any[];
    const bot = providers.find((b) => b.id === botId);
    if (!bot) throw new Error(`Bot not found: ${botId}`);
    return lambdaClient.agentBotProvider.connectBot.mutate({
      applicationId: bot.applicationId,
      platform: bot.platform,
    });
  },

  // ─── System Bot messenger management ─────────────────────────────────
  // Adapters around the existing `messenger.*` TRPC procedures, surfaced
  // through the same runtime so the frontend reuses the runtime's
  // formatting + empty-state copy. No new TRPC endpoints — `getMessengerDetail`
  // filters the list client-side because installs are small (<10 per user)
  // and the alternative is a one-off backend procedure.
  listMessengers: async () => {
    const installations = (await lambdaClient.messenger.listMyInstallations.query()) as any[];
    return installations.map((i) => ({
      applicationId: i.applicationId,
      enterpriseId: i.enterpriseId ?? null,
      id: i.id,
      installedAt:
        i.installedAt instanceof Date ? i.installedAt.toISOString() : String(i.installedAt),
      isEnterpriseInstall: i.isEnterpriseInstall === true,
      platform: i.platform,
      scope: i.scope ?? '',
      tenantId: i.tenantId,
      tenantName: i.tenantName ?? '',
    }));
  },

  getMessengerDetail: async (installationId) => {
    const installations = (await lambdaClient.messenger.listMyInstallations.query()) as any[];
    const install = installations.find((i) => i.id === installationId);
    if (!install) return null;
    return {
      applicationId: install.applicationId,
      enterpriseId: install.enterpriseId ?? null,
      id: install.id,
      installedAt:
        install.installedAt instanceof Date
          ? install.installedAt.toISOString()
          : String(install.installedAt),
      isEnterpriseInstall: install.isEnterpriseInstall === true,
      platform: install.platform,
      // `listMyInstallations` already filters revoked rows out, so any hit is active.
      revokedAt: null,
      scope: install.scope ?? '',
      tenantId: install.tenantId,
      tenantName: install.tenantName ?? '',
    };
  },

  uninstallMessenger: async (installationId) => {
    await lambdaClient.messenger.uninstallInstallation.mutate({ installationId });
  },

  listMessengerPlatforms: async () => {
    const platforms = (await lambdaClient.messenger.availablePlatforms.query()) as any[];
    return platforms.map((p) => ({
      appId: p.appId,
      botUsername: p.botUsername,
      id: p.id,
      name: p.name,
    }));
  },

  listMessengerLinks: async () => {
    const links = (await lambdaClient.messenger.listMyLinks.query()) as any[];
    return links.map((l) => ({
      activeAgentId: l.activeAgentId ?? null,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : String(l.createdAt),
      platform: l.platform,
      platformUserId: l.platformUserId,
      platformUsername: l.platformUsername ?? undefined,
      tenantId: l.tenantId || undefined,
    }));
  },

  setMessengerActiveAgent: async (params) => {
    await lambdaClient.messenger.setActiveAgent.mutate({
      agentId: params.agentId,
      platform: params.platform as any,
      tenantId: params.tenantId,
    });
  },

  unlinkMessenger: async (params) => {
    await lambdaClient.messenger.unlink.mutate({
      platform: params.platform as any,
      tenantId: params.tenantId,
    });
  },
};

// ────────────────────────────────────────────────────────────────────────
// Message service — send / read / edit / react / pin / channel / thread …
// ────────────────────────────────────────────────────────────────────────

/**
 * The `botMessage.*` TRPC procedures accept `{ botId, ...rest }` (no
 * `platform`); they resolve platform server-side from the bot row.
 *
 * Runtime callers pass `{ platform, ...rest }` and may omit `botId`. We
 * resolve `botId` from `platform` here (frontend convenience — find the
 * first enabled bot on that platform) and strip `platform` before
 * forwarding, mirroring the original `_callBotMessage` behavior.
 */
const resolveBotId = async (params: { botId?: string; platform?: string }): Promise<string> => {
  if (params.botId) return params.botId;
  if (!params.platform) {
    throw new Error('botId or platform is required');
  }
  const providers = (await lambdaClient.agentBotProvider.list.query()) as any[];
  const bot = providers.find((b) => b.platform === params.platform && b.enabled);
  if (!bot) {
    throw new Error(`No enabled bot found for platform "${params.platform}". Configure one first.`);
  }
  return bot.id;
};

/**
 * Build the TRPC input by resolving `botId` and stripping the
 * dispatch-only keys (`platform`, `botId` if injected) before merging
 * back in. Cast through `any` because the runtime's per-API param shapes
 * vary; the TRPC procedures will type-check the final shape.
 */
const buildTrpcInput = async (params: any): Promise<any> => {
  const botId = await resolveBotId(params);
  const { botId: _b, platform: _p, ...rest } = params ?? {};
  return { ...rest, botId };
};

export const trpcMessageService: MessageRuntimeService = {
  sendMessage: async (params) => {
    return lambdaClient.botMessage.sendMessage.mutate(await buildTrpcInput(params)) as any;
  },

  sendDirectMessage: async (params) => {
    return lambdaClient.botMessage.sendDirectMessage.mutate(await buildTrpcInput(params)) as any;
  },

  readMessages: async (params) => {
    return lambdaClient.botMessage.readMessages.query(await buildTrpcInput(params)) as any;
  },

  editMessage: async (params) => {
    return lambdaClient.botMessage.editMessage.mutate(await buildTrpcInput(params)) as any;
  },

  deleteMessage: async (params) => {
    return lambdaClient.botMessage.deleteMessage.mutate(await buildTrpcInput(params)) as any;
  },

  searchMessages: async (params) => {
    return lambdaClient.botMessage.searchMessages.query(await buildTrpcInput(params)) as any;
  },

  reactToMessage: async (params) => {
    return lambdaClient.botMessage.reactToMessage.mutate(await buildTrpcInput(params)) as any;
  },

  getReactions: async (params) => {
    return lambdaClient.botMessage.getReactions.query(await buildTrpcInput(params)) as any;
  },

  pinMessage: async (params) => {
    return lambdaClient.botMessage.pinMessage.mutate(await buildTrpcInput(params)) as any;
  },

  unpinMessage: async (params) => {
    return lambdaClient.botMessage.unpinMessage.mutate(await buildTrpcInput(params)) as any;
  },

  listPins: async (params) => {
    return lambdaClient.botMessage.listPins.query(await buildTrpcInput(params)) as any;
  },

  getChannelInfo: async (params) => {
    return lambdaClient.botMessage.getChannelInfo.query(await buildTrpcInput(params)) as any;
  },

  listChannels: async (params) => {
    return lambdaClient.botMessage.listChannels.query(await buildTrpcInput(params)) as any;
  },

  getMemberInfo: async (params) => {
    return lambdaClient.botMessage.getMemberInfo.query(await buildTrpcInput(params)) as any;
  },

  createThread: async (params) => {
    return lambdaClient.botMessage.createThread.mutate(await buildTrpcInput(params)) as any;
  },

  listThreads: async (params) => {
    return lambdaClient.botMessage.listThreads.query(await buildTrpcInput(params)) as any;
  },

  replyToThread: async (params) => {
    return lambdaClient.botMessage.replyToThread.mutate(await buildTrpcInput(params)) as any;
  },

  createPoll: async (params) => {
    return lambdaClient.botMessage.createPoll.mutate(await buildTrpcInput(params)) as any;
  },
};
