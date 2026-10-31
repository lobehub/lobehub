import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { withBotPlatformAccessMeta } from '@/business/server/bot/featureAccess';
import {
  getEnabledMessengerPlatforms,
  getMessengerDiscordConfig,
  getMessengerSlackConfig,
  getMessengerTelegramConfig,
} from '@/config/messenger';
import { WorkspaceModel } from '@/database/models/workspace';
import { router } from '@/libs/trpc/lambda';
import { messengerPlatformRegistry } from '@/server/services/messenger';

import {
  assertWorkspaceFeatureEnabledForUser,
  isWorkspaceFeatureEnabledForUser,
} from './agentScope';
import { messengerProcedure } from './procedures';

/** `withBotPlatformAccessMeta` may read access state per platform; keep the fan-out bounded. */
const PLATFORM_ACCESS_META_CONCURRENCY = 5;

export const bindingOptionsRouter = router({
  /**
   * Surface available platforms + bot deep-link metadata to the UI.
   *
   * The static per-platform fields (`id`, `name`, ...) come from the
   * registry's serialized definitions — same pattern as
   * `agentBotProvider.listPlatforms` for bot channels. Per-deployment
   * fields (`appId`, `botUsername`) layer on top from each platform's
   * DB-backed config:
   *
   * - Slack `appId` powers the verify-im success state's
   *   `slack://app?team=…&id=…` deep link straight into the bot DM.
   * - Discord `applicationId` doubles as the bot user id and feeds the
   *   LinkModal's OAuth2 install URL.
   */
  availablePlatforms: messengerProcedure.query(async ({ ctx }) => {
    const enabled = await getEnabledMessengerPlatforms();
    const enabledSet = new Set<string>(enabled);
    const definitions = messengerPlatformRegistry
      .listSerializedPlatforms()
      .filter((def) => enabledSet.has(def.id));

    const [discordConfig, slackConfig, telegramConfig] = await Promise.all([
      enabledSet.has('discord') ? getMessengerDiscordConfig() : Promise.resolve(null),
      enabledSet.has('slack') ? getMessengerSlackConfig() : Promise.resolve(null),
      enabledSet.has('telegram') ? getMessengerTelegramConfig() : Promise.resolve(null),
    ]);

    return pMap(
      definitions,
      async (def) => {
        const serialized = {
          ...def,
          appId:
            def.id === 'slack'
              ? slackConfig?.appId
              : def.id === 'discord'
                ? discordConfig?.applicationId
                : undefined,
          // Telegram-only: deep-link target (`https://t.me/<botUsername>`) — no
          // direct equivalent on Slack/Discord, both of which use App/Application
          // IDs to deep-link to the bot.
          botUsername: def.id === 'telegram' ? telegramConfig?.botUsername : undefined,
          enabled: true,
          // Legacy field — older callers index by `.platform` rather than `.id`.
          // Keep until those callers migrate; safe alias of the registry id.
          platform: def.id,
        };

        return withBotPlatformAccessMeta(serialized, { userId: ctx.userId });
      },
      { concurrency: PLATFORM_ACCESS_META_CONCURRENCY },
    );
  }),
  /**
   * Agent list for the verify-im UI's "pick an initial agent" dropdown.
   *
   * Excludes virtual agents (page-copilot, etc.) but explicitly keeps the
   * inbox/LobeAI agent — historical inbox sessions get migrated with
   * `virtual=true`, so a plain virtual filter would hide LobeAI even though
   * the home sidebar shows it (sidebar fetches it separately via
   * `agent.getBuiltinAgent`).
   *
   * Order matches the home sidebar (`updatedAt DESC`). Title fallback for the
   * inbox agent resolves to `"LobeAI"` + default avatar; everything else falls
   * back on the client via `common.defaultSession`.
   */
  listAgentsForBinding: messengerProcedure
    .input(z.object({ workspaceId: z.string().nullish() }).optional())
    .query(async ({ ctx, input }) => {
      const { serverDB, userId } = ctx;
      // Cascading scope: the caller picks a scope (personal or one of the
      // workspaces they belong to) and we return just that scope's agents.
      // Omitting `workspaceId` (or `null`) means personal.
      const workspaceId = input?.workspaceId ?? null;

      // Authorize the requested scope. Personal is always the caller's own; a
      // workspace scope requires membership, otherwise the caller could
      // enumerate another workspace's agents.
      if (workspaceId) {
        await assertWorkspaceFeatureEnabledForUser(userId);

        const userWorkspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
        if (!userWorkspaces.some((w) => w.id === workspaceId)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
        }
      }

      // Inbox meta fallback, the virtual-or-inbox filter, inbox pinning, and the
      // `isInbox` flag all live in the model. Blank non-inbox titles stay null
      // here so the web picker can apply its own i18n default.
      return ctx.getAgentModel(workspaceId).listMessengerBindableAgents();
    }),
  /**
   * List the scopes the user can route the System Bot to: their personal space
   * plus every workspace they belong to. Drives the connection card's
   * first-level "scope" selector; the second level then calls
   * `listAgentsForBinding({ workspaceId })` for the picked scope. Personal scope
   * is implicit (the client prepends it) — this only returns workspaces, so in
   * OSS / personal-only deployments it's simply an empty array.
   */
  listBindingScopes: messengerProcedure.query(async ({ ctx }) => {
    if (!(await isWorkspaceFeatureEnabledForUser(ctx.userId))) return [];

    const workspaces = await new WorkspaceModel(ctx.serverDB, ctx.userId).listUserWorkspaces();
    return workspaces.map((w) => ({ avatar: w.avatar, id: w.id, name: w.name }));
  }),
});
