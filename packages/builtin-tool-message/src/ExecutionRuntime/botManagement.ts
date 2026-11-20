import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ConnectBotParams,
  ConnectBotState,
  CreateBotParams,
  CreateBotState,
  DeleteBotParams,
  DeleteBotState,
  GetBotDetailParams,
  GetBotDetailState,
  GetMessengerDetailParams,
  GetMessengerDetailState,
  ListBotsParams,
  ListBotsState,
  ListMessengerLinksParams,
  ListMessengerLinksState,
  ListMessengerPlatformsParams,
  ListMessengerPlatformsState,
  ListMessengersParams,
  ListMessengersState,
  ListPlatformsParams,
  ListPlatformsState,
  MessengerPushPlatformType,
  MessengerPushWorkspaceOption,
  SendMessengerPushParams,
  SendMessengerPushState,
  SetMessengerActiveAgentParams,
  SetMessengerActiveAgentState,
  ToggleBotParams,
  ToggleBotState,
  UninstallMessengerParams,
  UninstallMessengerState,
  UnlinkMessengerParams,
  UnlinkMessengerState,
  UpdateBotParams,
  UpdateBotState,
} from '../types';
import { ChannelMessageRuntime } from './channelMessages';
import type { BotProviderQuery, MessageExecutionRuntimeOptions } from './types';

/**
 * The message tool's runtime: channel operations from `ChannelMessageRuntime`, plus managing the
 * user's bots and System Bot messenger installs through `BotProviderQuery`.
 */
export class MessageExecutionRuntime extends ChannelMessageRuntime {
  private botProvider?: BotProviderQuery;

  constructor(options: MessageExecutionRuntimeOptions) {
    super(options);
    this.botProvider = options.botProvider;
  }

  // ==================== Bot Management ====================

  async listPlatforms(_params: ListPlatformsParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const platforms = await this.botProvider.listPlatforms();
      const formatted = platforms
        .map((p) => {
          const reqFields = p.credentialFields
            .filter((f) => f.required)
            .map((f) => f.key)
            .join(', ');
          return `- **${p.name}** (${p.id})${reqFields ? ` — requires: ${reqFields}` : ''}`;
        })
        .join('\n');

      return {
        content: `${platforms.length} supported platform(s):\n${formatted}`,
        state: { platforms } satisfies ListPlatformsState,
        success: true,
      };
    } catch (e) {
      return { content: `listPlatforms error: ${(e as Error).message}`, success: false };
    }
  }

  async listBots(_params: ListBotsParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return {
        content: 'Bot provider query is not available in this context.',
        success: false,
      };
    }

    try {
      const bots = await this.botProvider.listBots();
      const formatted = bots
        .map((b) => {
          const parts = [
            `platform: ${b.platform}`,
            `botId: ${b.id}`,
            `enabled: ${b.enabled}`,
            `status: ${b.runtimeStatus ?? 'unknown'}`,
          ];
          if (b.serverId) {
            parts.push(`serverId: ${b.serverId}`);
          }
          if (b.userId) {
            parts.push(`userId: ${b.userId}`);
          }
          return `- ${b.platform} (${parts.join(', ')})`;
        })
        .join('\n');

      return {
        content:
          bots.length > 0
            ? `${bots.length} configured bot(s):\n${formatted}`
            : 'No bots configured for this agent. Set up a bot integration first.',
        state: { bots } satisfies ListBotsState,
        success: true,
      };
    } catch (e) {
      return {
        content: `listBots error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async getBotDetail(params: GetBotDetailParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const bot = await this.botProvider.getBotDetail(params.botId);
      if (!bot) {
        return { content: `Bot not found: ${params.botId}`, success: false };
      }
      return {
        content: `Bot ${bot.id}:\n- Platform: ${bot.platform}\n- App ID: ${bot.applicationId}\n- Enabled: ${bot.enabled}\n- Status: ${bot.runtimeStatus ?? 'unknown'}${bot.settings ? `\n- Settings: ${JSON.stringify(bot.settings)}` : ''}`,
        state: bot satisfies GetBotDetailState,
        success: true,
      };
    } catch (e) {
      return { content: `getBotDetail error: ${(e as Error).message}`, success: false };
    }
  }

  async createBot(params: CreateBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const result = await this.botProvider.createBot(params);
      return {
        content: `Created ${result.platform} bot (id: ${result.id})`,
        state: result satisfies CreateBotState,
        success: true,
      };
    } catch (e) {
      return { content: `createBot error: ${(e as Error).message}`, success: false };
    }
  }

  async updateBot(params: UpdateBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.updateBot(params.botId, {
        credentials: params.credentials,
        settings: params.settings,
      });
      return {
        content: `Updated bot ${params.botId}`,
        state: { success: true } satisfies UpdateBotState,
        success: true,
      };
    } catch (e) {
      return { content: `updateBot error: ${(e as Error).message}`, success: false };
    }
  }

  async deleteBot(params: DeleteBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.deleteBot(params.botId);
      return {
        content: `Deleted bot ${params.botId}`,
        state: { success: true } satisfies DeleteBotState,
        success: true,
      };
    } catch (e) {
      return { content: `deleteBot error: ${(e as Error).message}`, success: false };
    }
  }

  async toggleBot(params: ToggleBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      await this.botProvider.toggleBot(params.botId, params.enabled);
      return {
        content: `Bot ${params.botId} ${params.enabled ? 'enabled' : 'disabled'}`,
        state: { enabled: params.enabled, success: true } satisfies ToggleBotState,
        success: true,
      };
    } catch (e) {
      return { content: `toggleBot error: ${(e as Error).message}`, success: false };
    }
  }

  async connectBot(params: ConnectBotParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider) {
      return { content: 'Bot provider is not available.', success: false };
    }
    try {
      const result = await this.botProvider.connectBot(params.botId);
      return {
        content: `Bot connection initiated (status: ${result.status})`,
        state: result satisfies ConnectBotState,
        success: true,
      };
    } catch (e) {
      return { content: `connectBot error: ${(e as Error).message}`, success: false };
    }
  }

  // ==================== System Bot Messenger Management ====================

  async listMessengers(_params: ListMessengersParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.listMessengers) {
      return {
        content: 'System Bot messenger discovery is not available in this context.',
        success: false,
      };
    }
    try {
      const installations = await this.botProvider.listMessengers();
      if (installations.length === 0) {
        return {
          content:
            'No System Bot connections found. Tell the user to connect one via Settings → Messenger; `listMessengerPlatforms` shows what platforms are available.',
          state: { installations } satisfies ListMessengersState,
          success: true,
        };
      }
      const lines = installations.map((i) => {
        const parts = [`installationId: ${i.id}`, `platform: ${i.platform}`];
        if (i.tenantName) parts.push(`tenant: ${i.tenantName}`);
        else if (i.tenantId) parts.push(`tenantId: ${i.tenantId}`);
        if (i.installedAt) {
          const at = i.installedAt instanceof Date ? i.installedAt.toISOString() : i.installedAt;
          parts.push(`installedAt: ${at}`);
        }
        return `- ${parts.join(', ')}`;
      });
      return {
        content: `${installations.length} System Bot connection(s):\n${lines.join('\n')}`,
        state: { installations } satisfies ListMessengersState,
        success: true,
      };
    } catch (e) {
      return { content: `listMessengers error: ${(e as Error).message}`, success: false };
    }
  }

  async getMessengerDetail(params: GetMessengerDetailParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.getMessengerDetail) {
      return { content: 'getMessengerDetail is not available.', success: false };
    }
    try {
      const install = await this.botProvider.getMessengerDetail(params.installationId);
      if (!install) {
        return {
          content: `Messenger installation not found: ${params.installationId}`,
          success: false,
        };
      }
      const lines = [
        `installationId: ${install.id}`,
        `platform: ${install.platform}`,
        `tenantId: ${install.tenantId || '(global)'}`,
      ];
      if (install.tenantName) lines.push(`tenant: ${install.tenantName}`);
      if (install.applicationId) lines.push(`applicationId: ${install.applicationId}`);
      if (install.scope) lines.push(`scope: ${install.scope}`);
      if (install.installedAt) {
        const at =
          install.installedAt instanceof Date
            ? install.installedAt.toISOString()
            : install.installedAt;
        lines.push(`installedAt: ${at}`);
      }
      lines.push(`revoked: ${install.revokedAt ? 'yes' : 'no'}`);
      return {
        content: lines.join('\n'),
        state: install satisfies GetMessengerDetailState,
        success: true,
      };
    } catch (e) {
      return { content: `getMessengerDetail error: ${(e as Error).message}`, success: false };
    }
  }

  async uninstallMessenger(params: UninstallMessengerParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.uninstallMessenger) {
      return { content: 'uninstallMessenger is not available.', success: false };
    }
    try {
      await this.botProvider.uninstallMessenger(params.installationId);
      return {
        content: `System Bot connection ${params.installationId} disconnected.`,
        state: { success: true } satisfies UninstallMessengerState,
        success: true,
      };
    } catch (e) {
      return { content: `uninstallMessenger error: ${(e as Error).message}`, success: false };
    }
  }

  async listMessengerPlatforms(
    _params: ListMessengerPlatformsParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.listMessengerPlatforms) {
      return { content: 'listMessengerPlatforms is not available.', success: false };
    }
    try {
      const platforms = await this.botProvider.listMessengerPlatforms();
      if (platforms.length === 0) {
        return {
          content:
            'No System Bot platforms are configured on this deployment. Ask the operator to enable at least one platform under Messenger configuration.',
          state: { platforms } satisfies ListMessengerPlatformsState,
          success: true,
        };
      }
      const lines = platforms.map((p) => {
        const parts = [p.id];
        if (p.name && p.name !== p.id) parts.push(`(${p.name})`);
        if (p.appId) parts.push(`appId: ${p.appId}`);
        if (p.botUsername) parts.push(`botUsername: ${p.botUsername}`);
        return `- ${parts.join(' ')}`;
      });
      return {
        content: `${platforms.length} platform(s) available for System Bot install:\n${lines.join('\n')}\n\nInstalls are initiated via Settings → Messenger (OAuth requires a browser).`,
        state: { platforms } satisfies ListMessengerPlatformsState,
        success: true,
      };
    } catch (e) {
      return {
        content: `listMessengerPlatforms error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listMessengerLinks(_params: ListMessengerLinksParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.listMessengerLinks) {
      return { content: 'listMessengerLinks is not available.', success: false };
    }
    try {
      const links = await this.botProvider.listMessengerLinks();
      if (links.length === 0) {
        return {
          content:
            'No System Bot account links. The user has not completed verify-im on any platform yet.',
          state: { links } satisfies ListMessengerLinksState,
          success: true,
        };
      }
      const lines = links.map((l) => {
        const parts = [`platform: ${l.platform}`];
        if (l.tenantId) parts.push(`tenantId: ${l.tenantId}`);
        parts.push(`activeAgentId: ${l.activeAgentId ?? '(none)'}`);
        if (l.platformUsername) parts.push(`platformUser: ${l.platformUsername}`);
        return `- ${parts.join(', ')}`;
      });
      return {
        content: `${links.length} System Bot link(s):\n${lines.join('\n')}`,
        state: { links } satisfies ListMessengerLinksState,
        success: true,
      };
    } catch (e) {
      return { content: `listMessengerLinks error: ${(e as Error).message}`, success: false };
    }
  }

  async setMessengerActiveAgent(
    params: SetMessengerActiveAgentParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.setMessengerActiveAgent) {
      return { content: 'setMessengerActiveAgent is not available.', success: false };
    }
    try {
      await this.botProvider.setMessengerActiveAgent(params);
      const target = params.agentId === null ? 'cleared' : `set to agent ${params.agentId}`;
      const scope = params.tenantId ? ` (tenant ${params.tenantId})` : '';
      return {
        content: `Active agent for ${params.platform}${scope} ${target}.`,
        state: { success: true } satisfies SetMessengerActiveAgentState,
        success: true,
      };
    } catch (e) {
      return {
        content: `setMessengerActiveAgent error: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async unlinkMessenger(params: UnlinkMessengerParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.unlinkMessenger) {
      return { content: 'unlinkMessenger is not available.', success: false };
    }
    try {
      await this.botProvider.unlinkMessenger(params);
      const scope = params.tenantId ? ` (tenant ${params.tenantId})` : '';
      return {
        content: `Unlinked your account from ${params.platform}${scope}. The workspace install is unaffected.`,
        state: { success: true } satisfies UnlinkMessengerState,
        success: true,
      };
    } catch (e) {
      return { content: `unlinkMessenger error: ${(e as Error).message}`, success: false };
    }
  }

  // ==================== Proactive Messenger Push ====================

  /**
   * Resolve the Slack workspace a push should target when the caller didn't
   * pass `tenantId`. Returns the single linked tenantId, or the candidate
   * list when the choice is ambiguous (the user linked several workspaces).
   */
  private async resolveSlackPushTenant(): Promise<
    { tenantId?: string } | { workspaces: MessengerPushWorkspaceOption[] }
  > {
    const links = (await this.botProvider!.listMessengerLinks?.()) ?? [];
    const slackTenantIds = links
      .filter((link) => link.platform === 'slack' && link.tenantId)
      .map((link) => link.tenantId!);
    if (slackTenantIds.length <= 1) return { tenantId: slackTenantIds[0] };

    // Enrich with workspace names so the agent can present readable choices;
    // installs may be missing (installed by a teammate) — fall back to the id.
    const installs = await this.botProvider!.listMessengers?.().catch(() => []);
    const nameByTenant = new Map(
      (installs ?? [])
        .filter((install) => install.platform === 'slack')
        .map((install) => [install.tenantId, install.tenantName]),
    );
    return {
      workspaces: slackTenantIds.map((tenantId) => ({
        tenantId,
        tenantName: nameByTenant.get(tenantId) || undefined,
      })),
    };
  }

  async sendMessengerPush(params: SendMessengerPushParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.botProvider?.sendMessengerPush) {
      return { content: 'sendMessengerPush is not available.', success: false };
    }
    const platform = params.platform as MessengerPushPlatformType;
    try {
      let tenantId = params.tenantId;

      // Slack links can span several workspaces — never pick one silently.
      if (platform === 'slack' && tenantId === undefined) {
        const resolved = await this.resolveSlackPushTenant();
        if ('workspaces' in resolved) {
          const lines = resolved.workspaces.map(
            (w) => `- ${w.tenantName ?? w.tenantId} (tenantId: ${w.tenantId})`,
          );
          return {
            content:
              `The user's Slack account is linked to ${resolved.workspaces.length} workspaces:\n${lines.join('\n')}\n\n` +
              'Ask the user which workspace to push to, then call sendMessengerPush again with that tenantId.',
            state: {
              platform,
              status: 'needs_workspace_selection',
              workspaces: resolved.workspaces,
            } satisfies SendMessengerPushState,
            success: true,
          };
        }
        tenantId = resolved.tenantId;
      }

      const result = await this.botProvider.sendMessengerPush({
        content: params.content,
        platform,
        tenantId,
      });
      const state: SendMessengerPushState = {
        platform,
        remaining: result.remaining,
        status: result.status,
        tenantId,
      };

      switch (result.status) {
        case 'sent': {
          const quota =
            platform === 'wechat' && result.remaining !== undefined
              ? ` (${result.remaining} sends left in the current WeChat window)`
              : '';
          return {
            content: `Message pushed to the user's ${platform} DM${quota}.`,
            state,
            success: true,
          };
        }
        case 'queued': {
          return {
            // Queued is a success: delivery is deferred, not dropped. The
            // agent must relay the "message the bot first" step to the user.
            content:
              'The WeChat send window is closed or its quota is exhausted, so the message was queued. ' +
              'Tell the user to send any message to the LobeHub WeChat bot first — the queued push will be delivered right after their message opens a new window.',
            state,
            success: true,
          };
        }
        case 'unlinked': {
          return {
            content: `The user has no linked ${platform} account for the LobeHub System Bot. Ask them to open Settings → Messenger and connect ${platform} first.`,
            state,
            success: false,
          };
        }
        default: {
          return {
            content: `Proactive push to ${platform} is currently unavailable — the platform is not configured on this deployment or delivery failed. Do not retry immediately; surface this to the user.`,
            state,
            success: false,
          };
        }
      }
    } catch (e) {
      return { content: `sendMessengerPush error: ${(e as Error).message}`, success: false };
    }
  }
}
