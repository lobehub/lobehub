import { AgentModel } from '@/database/models/agent';
import {
  AgentBotProviderModel,
  type DecryptedBotProvider,
} from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { agentBotProviderRouter } from '@/server/routers/lambda/agentBotProvider';
import { botMessageRouter } from '@/server/routers/lambda/botMessage';
import { maskCredentials } from '@/server/services/bot/credentialMasking';
import { withResolvedConcurrencySettings } from '@/server/services/bot/platforms';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

import { BaseService } from '../common/base.service';
import { resolvePagination } from '../helpers/pagination';
import type {
  BotConnectionTest,
  BotListQuery,
  BotMessageSent,
  BotResponse,
  CreateBotRequest,
  SendBotMessageRequest,
  UpdateBotRequest,
} from '../types/bot.type';
import type { DeletedResource } from '../types/common.type';

const BOT_NOT_FOUND = 'Bot not found';

/**
 * Agent bots REST service.
 *
 * Mutations go through the `agentBotProvider` / `botMessage` tRPC procedures
 * (called server-side) so REST shares their credential masking round-trip,
 * format checks, access-policy validation, conflict messages, runtime cache
 * invalidation and workspace-row guards. Reads use the same scoped model the
 * procedures use, so a bot in another account or workspace reads as missing.
 */
export class BotRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  private get bots() {
    return agentBotProviderRouter.createCaller(this.ctx);
  }

  private get messages() {
    return botMessageRouter.createCaller(this.ctx);
  }

  private async model() {
    return new AgentBotProviderModel(
      this.db,
      this.userId,
      await KeyVaultsGateKeeper.initWithEnvKey(),
      this.workspaceId,
    );
  }

  private async toBot(row: DecryptedBotProvider): Promise<BotResponse> {
    const { status } = await getBotRuntimeStatus(row.platform, row.applicationId);
    return {
      agentId: row.agentId,
      applicationId: row.applicationId,
      createdAt: row.createdAt.toISOString(),
      // Never hand a secret back, not even to its owner: `update` resolves a
      // mask to the stored value, so a read-modify-write round-trips safely.
      credentials: maskCredentials(row.platform, row.credentials),
      enabled: row.enabled,
      id: row.id,
      platform: row.platform,
      runtimeStatus: status,
      settings:
        withResolvedConcurrencySettings(
          row.platform,
          (row.settings as Record<string, unknown> | null) ?? {},
        ) ?? {},
      updatedAt: row.updatedAt.toISOString(),
      workspaceId: row.workspaceId ?? null,
    };
  }

  private async requireBot(id: string): Promise<DecryptedBotProvider> {
    const row = await (await this.model()).findById(id);
    if (!row) throw this.createNotFoundError(BOT_NOT_FOUND);
    return row;
  }

  private async requireEnabledBot(id: string, action: string): Promise<DecryptedBotProvider> {
    const row = await this.requireBot(id);
    if (!row.enabled) throw this.createConflictError(`Enable the bot before you ${action}`);
    return row;
  }

  async list(query: BotListQuery) {
    const { limit, offset } = resolvePagination(query);
    const rows = await (
      await this.model()
    ).query({ agentId: query.agentId, platform: query.platform });
    const page = rows.slice(offset, offset + limit);
    return { items: await Promise.all(page.map((row) => this.toBot(row))), total: rows.length };
  }

  async get(id: string) {
    return this.toBot(await this.requireBot(id));
  }

  async create(input: CreateBotRequest) {
    // The procedure trusts its caller for the agent; REST must not wire a bot
    // to an agent outside the caller's scope.
    const agentExists = await new AgentModel(this.db, this.userId, this.workspaceId).existsById(
      input.agentId,
    );
    if (!agentExists) throw this.createNotFoundError('Agent not found');

    const created = await this.bots.create(input);

    if (input.enabled !== false) {
      // Same order as the channel page: save, then connect. A connect failure
      // is reported through `runtimeStatus`, not by failing a create that
      // already happened.
      try {
        await this.bots.connectBot({
          applicationId: created.applicationId,
          platform: created.platform,
        });
      } catch (error) {
        this.log('warn', 'connect after create failed', { error, id: created.id });
      }
    }

    return this.get(created.id);
  }

  async update(id: string, input: UpdateBotRequest) {
    await this.requireBot(id);
    await this.bots.update({ id, ...input });
    return this.get(id);
  }

  async delete(id: string): Promise<DeletedResource> {
    // Checked in scope first: the procedure would otherwise reach across into
    // the caller's other scope to reclaim a stranded binding.
    await this.requireBot(id);
    await this.bots.delete({ id });
    return { deleted: true, id };
  }

  async enable(id: string) {
    const row = await this.requireBot(id);
    await this.bots.update({ enabled: true, id });
    await this.bots.connectBot({ applicationId: row.applicationId, platform: row.platform });
    return this.get(id);
  }

  async disable(id: string) {
    await this.requireBot(id);
    // `update` stops the running client when a bot is switched off.
    await this.bots.update({ enabled: false, id });
    return this.get(id);
  }

  async test(id: string): Promise<BotConnectionTest> {
    const row = await this.requireEnabledBot(id, 'test its connection');
    const result = await this.bots.testConnection({
      applicationId: row.applicationId,
      platform: row.platform,
    });
    if (result.valid) return { errors: [], valid: true };
    return {
      errors: result.errors.map((error) => ({
        ...('code' in error && error.code ? { code: String(error.code) } : {}),
        field: error.field,
        message: error.message,
      })),
      valid: false,
    };
  }

  async sendMessage(id: string, input: SendBotMessageRequest): Promise<BotMessageSent> {
    await this.requireEnabledBot(id, 'send messages with it');
    const sent = await this.messages.sendMessage({ ...input, botId: id });
    return {
      channelId: sent.channelId ?? input.channelId,
      messageId: sent.messageId ?? '',
      platform: sent.platform ?? '',
    };
  }
}
