/**
 * Lobe Message Executor
 *
 * Frontend executor for the Message builtin tool.
 * Delegates all operations to the server via TRPC since they require
 * database access (bot credentials, platform adapters).
 */
import { MessageApiName, MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { agentBotProviderService } from '@/services/agentBotProvider';

class MessageExecutor extends BaseExecutor<typeof MessageApiName> {
  readonly identifier = MessageToolIdentifier;
  protected readonly apiEnum = MessageApiName;

  // ==================== Bot Management ====================

  listPlatforms = async (_params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    try {
      const platforms = await agentBotProviderService.listPlatforms();
      const items = (platforms as any[]).map((p: any) => {
        const credSchema = (p.schema ?? []).find(
          (f: any) => f.key === 'credentials' && f.properties,
        );
        const fields = (credSchema?.properties ?? []) as any[];
        const reqFields = fields
          .filter((f: any) => f.required)
          .map((f: any) => f.key)
          .join(', ');
        return `- **${p.name}** (${p.id})${reqFields ? ` — requires: ${reqFields}` : ''}`;
      });

      return {
        content: `${(platforms as any[]).length} supported platform(s):\n${items.join('\n')}`,
        state: { platforms },
        success: true,
      };
    } catch (e) {
      return { content: `listPlatforms error: ${(e as Error).message}`, success: false };
    }
  };

  listBots = async (_params: any, ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    try {
      const agentId = ctx.agentId;
      if (!agentId) {
        return { content: 'agentId is required to list bots', success: false };
      }

      const bots = await agentBotProviderService.getByAgentId(agentId);
      const items = (bots as any[]).map((b: any) => {
        const parts = [
          `platform: ${b.platform}`,
          `botId: ${b.id}`,
          `enabled: ${b.enabled}`,
          `status: ${b.runtimeStatus ?? 'unknown'}`,
        ];
        if (b.settings?.serverId) {
          parts.push(`serverId: ${b.settings.serverId}`);
        }
        if (b.settings?.userId) {
          parts.push(`userId: ${b.settings.userId}`);
        }
        return `- ${b.platform} (${parts.join(', ')})`;
      });

      return {
        content:
          (bots as any[]).length > 0
            ? `${(bots as any[]).length} configured bot(s):\n${items.join('\n')}`
            : 'No bots configured for this agent. Set up a bot integration first.',
        state: { bots },
        success: true,
      };
    } catch (e) {
      return { content: `listBots error: ${(e as Error).message}`, success: false };
    }
  };

  getBotDetail = async (
    params: { botId: string },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const bots = await lambdaClient.agentBotProvider.list.query();
      const bot = (bots as any[]).find((b: any) => b.id === params.botId);
      if (!bot) {
        return { content: `Bot not found: ${params.botId}`, success: false };
      }
      return {
        content: `Bot ${bot.id}:\n- Platform: ${bot.platform}\n- App ID: ${bot.applicationId}\n- Enabled: ${bot.enabled}\n- Status: ${bot.runtimeStatus ?? 'unknown'}`,
        state: bot,
        success: true,
      };
    } catch (e) {
      return { content: `getBotDetail error: ${(e as Error).message}`, success: false };
    }
  };

  createBot = async (
    params: {
      agentId: string;
      applicationId: string;
      credentials: Record<string, string>;
      platform: string;
    },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const result = await agentBotProviderService.create(params);
      return {
        content: `Created ${params.platform} bot (id: ${(result as any).id})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return { content: `createBot error: ${(e as Error).message}`, success: false };
    }
  };

  updateBot = async (
    params: {
      botId: string;
      credentials?: Record<string, string>;
      settings?: Record<string, unknown>;
    },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      await agentBotProviderService.update(params.botId, {
        credentials: params.credentials,
        settings: params.settings,
      });
      return { content: `Updated bot ${params.botId}`, state: { success: true }, success: true };
    } catch (e) {
      return { content: `updateBot error: ${(e as Error).message}`, success: false };
    }
  };

  deleteBot = async (
    params: { botId: string },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      await agentBotProviderService.delete(params.botId);
      return { content: `Deleted bot ${params.botId}`, state: { success: true }, success: true };
    } catch (e) {
      return { content: `deleteBot error: ${(e as Error).message}`, success: false };
    }
  };

  toggleBot = async (
    params: { botId: string; enabled: boolean },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      await agentBotProviderService.update(params.botId, { enabled: params.enabled });
      return {
        content: `Bot ${params.botId} ${params.enabled ? 'enabled' : 'disabled'}`,
        state: { enabled: params.enabled, success: true },
        success: true,
      };
    } catch (e) {
      return { content: `toggleBot error: ${(e as Error).message}`, success: false };
    }
  };

  connectBot = async (
    params: { botId: string },
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      // Look up bot to get platform + applicationId
      const bots = await lambdaClient.agentBotProvider.list.query();
      const bot = (bots as any[]).find((b: any) => b.id === params.botId);
      if (!bot) {
        return { content: `Bot not found: ${params.botId}`, success: false };
      }

      const result = await agentBotProviderService.connectBot({
        applicationId: bot.applicationId,
        platform: bot.platform,
      });
      return {
        content: `Bot connection initiated (status: ${result.status})`,
        state: result,
        success: true,
      };
    } catch (e) {
      return { content: `connectBot error: ${(e as Error).message}`, success: false };
    }
  };

  // ==================== Direct Messaging ====================

  sendDirectMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('sendDirectMessage', params);
  };

  // ==================== Message Operations ====================
  // All message operations go through the botMessage TRPC router

  sendMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('sendMessage', params);
  };

  readMessages = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('readMessages', params, 'query');
  };

  editMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('editMessage', params);
  };

  deleteMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('deleteMessage', params);
  };

  searchMessages = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('searchMessages', params, 'query');
  };

  reactToMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('reactToMessage', params);
  };

  getReactions = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('getReactions', params, 'query');
  };

  pinMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('pinMessage', params);
  };

  unpinMessage = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('unpinMessage', params);
  };

  listPins = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('listPins', params, 'query');
  };

  getChannelInfo = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('getChannelInfo', params, 'query');
  };

  listChannels = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('listChannels', params, 'query');
  };

  getMemberInfo = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('getMemberInfo', params, 'query');
  };

  createThread = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('createThread', params);
  };

  listThreads = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('listThreads', params, 'query');
  };

  replyToThread = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('replyToThread', params);
  };

  createPoll = async (params: any, _ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    return this._callBotMessage('createPoll', params);
  };

  // ==================== Internal Helper ====================

  /**
   * Route a message operation to the botMessage TRPC router.
   * The AI provides `platform` + `channelId`, but the TRPC router needs `botId`.
   * We resolve the botId by looking up the bot for the given platform.
   */
  private _callBotMessage = async (
    apiName: string,
    params: any,
    method: 'mutate' | 'query' = 'mutate',
  ): Promise<BuiltinToolResult> => {
    try {
      let botId = params.botId as string | undefined;

      // Resolve botId from platform if not provided
      if (!botId && params.platform) {
        const bots = await lambdaClient.agentBotProvider.list.query();
        const bot = (bots as any[]).find((b: any) => b.platform === params.platform && b.enabled);
        if (!bot) {
          return {
            content: `No enabled bot found for platform "${params.platform}". Configure one first.`,
            success: false,
          };
        }
        botId = bot.id;
      }

      if (!botId) {
        return { content: 'botId or platform is required', success: false };
      }

      const router = lambdaClient.botMessage as any;
      const procedure = router[apiName];
      if (!procedure) {
        return { content: `Unknown message API: ${apiName}`, success: false };
      }

      const { botId: _, platform: __, ...rest } = params;
      const input = { botId, ...rest };
      const result =
        method === 'query' ? await procedure.query(input) : await procedure.mutate(input);

      return {
        content: JSON.stringify(result),
        state: result,
        success: true,
      };
    } catch (e) {
      return { content: `${apiName} error: ${(e as Error).message}`, success: false };
    }
  };
}

export const messageExecutor = new MessageExecutor();
