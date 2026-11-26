import type {
  GenericWebhookTopicMode,
  InboundWebhookChannelDelivery,
  InboundWebhookDeliveryPage,
  InboundWebhookItem,
  InboundWebhookItemWithSecret,
  InboundWebhookKind,
} from '@lobechat/types';

import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookLimitError, InboundWebhookModel } from '@/database/models/inboundWebhook';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { redisService } from '@/server/services/redis';
import { assertCanEditResource } from '@/server/services/resourcePermission';

import { assertChannelDelivery, ChannelDeliveryError } from './channelDelivery';
import { listInboundWebhookDeliveries } from './deliveries';
import { isWebhookEnabled } from './featureGate';
import { canConfigureInboundWebhook, canManageInboundWebhook, inboundWebhookItems } from './items';
import { getInboundWebhookKind } from './kinds';
import {
  asGeneric,
  createGenericWebhook,
  GenericWebhookError,
  rotateGenericWebhookToken,
  sendGenericWebhookTest,
  updateGenericWebhook,
} from './kinds/generic/service';
import { removeInboundWebhook } from './lifecycle';

export type InboundWebhookManageErrorCode =
  'bad_request' | 'disabled' | 'forbidden' | 'not_found' | 'rate_limited';

export class InboundWebhookManageError extends Error {
  constructor(
    readonly code: InboundWebhookManageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InboundWebhookManageError';
  }
}

/** Who manages: the signed-in member, in a workspace or personal scope. */
export interface InboundWebhookManageScope {
  clientIp?: string | null;
  userId: string;
  workspaceId?: string | null;
  /** Absent outside a request (an agent tool): the caller then manages only their own rows. */
  workspaceRole?: string;
}

/** What a generic webhook runs; every field optional on update. */
export interface GenericWebhookChanges {
  autoApprove?: boolean;
  /** Post each run's answer to a Channel or Thread; null stops posting. */
  delivery?: InboundWebhookChannelDelivery | null;
  instructions?: string | null;
  name?: string | null;
  topicId?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

const notFound = () => new InboundWebhookManageError('not_found', 'Webhook not found.');

/** Map domain errors to the codes the router and agent tools speak. */
const toManageError = (error: unknown) => {
  if (error instanceof InboundWebhookManageError) return error;
  if (error instanceof GenericWebhookError)
    return error.code === 'not_found'
      ? notFound()
      : new InboundWebhookManageError('bad_request', error.message);
  if (error instanceof ChannelDeliveryError)
    return new InboundWebhookManageError('bad_request', error.message);
  if (error instanceof InboundWebhookLimitError)
    return new InboundWebhookManageError('rate_limited', error.message);
  return error;
};

const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    throw toManageError(error);
  }
};

/**
 * Managing inbound webhooks (custom webhooks and MCP Events subscriptions), shared by the Web
 * (TRPC), the `lh` CLI (through the same TRPC) and the agent's webhook tools, so each enforces the
 * same rules:
 *
 * - Managing a row (pause, delete, check) is its creator's, or a workspace owner's or admin's.
 * - What a webhook runs acts on its agent as its creator, so changing it, testing it and issuing
 *   a key need `edit` on the agent and the creator themself.
 * - MCP Events subscriptions are created by the agent's tool in a conversation, never here.
 */
export class InboundWebhookManager {
  private readonly model: InboundWebhookModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly scope: InboundWebhookManageScope,
  ) {
    this.model = new InboundWebhookModel(db, scope.userId, scope.workspaceId ?? undefined);
  }

  private get ownScope() {
    return { userId: this.scope.userId, workspaceId: this.scope.workspaceId ?? undefined };
  }

  private items(rows: InboundWebhookView[]) {
    return inboundWebhookItems(this.db, rows, this.scope);
  }

  private async item(row: InboundWebhookView) {
    const [item] = await this.items([row]);
    if (!item) throw notFound();
    return item;
  }

  private async audit(
    action: 'webhook.created' | 'webhook.updated' | 'webhook.deleted',
    row: InboundWebhookView,
    metadata: Record<string, unknown> = {},
  ) {
    if (!this.scope.workspaceId) return;
    await new WorkspaceAuditLogModel(this.db).create({
      action,
      ipAddress: this.scope.clientIp ?? undefined,
      metadata: { direction: 'inbound', kind: row.kind, ...metadata },
      resourceId: row.id,
      resourceType: 'webhook',
      userId: this.scope.userId,
      workspaceId: this.scope.workspaceId,
    });
  }

  /** A row the caller may manage; others are not found or forbidden. */
  private async manageable(id: string) {
    const row = await this.model.findById(id);
    if (!row || row.status === 'pending' || row.status === 'deleting') throw notFound();
    if (!canManageInboundWebhook(this.scope, row))
      throw new InboundWebhookManageError(
        'forbidden',
        'Only the creator or a workspace owner or admin can manage this webhook.',
      );
    return row;
  }

  private async assertEnabled() {
    if (!(await isWebhookEnabled(this.scope.userId)))
      throw new InboundWebhookManageError('disabled', 'Webhooks are not enabled.');
  }

  /**
   * Its task, its key, a test run and what callers sent act on the agent: `use` to see, `edit` to
   * change or run. A workspace admin may stop a colleague's webhook without driving that agent.
   */
  private async assertAgentAccess(agentId: string, level: 'edit' | 'use') {
    await assertAgentUsableBy(this.db, agentId, this.ownScope);
    if (level === 'edit')
      await assertCanEditResource({
        db: this.db,
        resourceId: agentId,
        resourceType: 'agent',
        ...this.ownScope,
      });
  }

  /** A webhook runs as its creator; only they change what it runs, test it or get its key. */
  private assertConfigures(row: InboundWebhookView) {
    if (!canConfigureInboundWebhook(this.scope, row))
      throw new InboundWebhookManageError(
        'forbidden',
        'Only the member who created this webhook can change what it runs.',
      );
  }

  private async manageableGeneric(id: string) {
    await this.assertEnabled();
    const row = await this.manageable(id);
    return guard(async () => asGeneric(row));
  }

  list(input: { agentId?: string; kind?: InboundWebhookKind } = {}): Promise<InboundWebhookItem[]> {
    return guard(async () =>
      this.items(await this.model.query({ agentId: input.agentId, kind: input.kind })),
    );
  }

  get(id: string): Promise<InboundWebhookItem> {
    return guard(async () => {
      const row = await this.model.findById(id);
      if (!row) throw notFound();
      return this.item(row);
    });
  }

  /** A custom webhook for an agent the caller may edit, with its key: the only time it is shown. */
  create(
    input: GenericWebhookChanges & { agentId: string },
  ): Promise<InboundWebhookItemWithSecret> {
    return guard(async () => {
      await this.assertEnabled();
      await this.assertAgentAccess(input.agentId, 'edit');
      const { row, secret } = await createGenericWebhook(this.db, this.ownScope, {
        ...input,
        delivery: input.delivery ?? undefined,
      });
      await this.audit('webhook.created', row, {
        autoApprove: row.config.autoApprove,
        ...(row.config.delivery && { channelId: row.config.delivery.channelId }),
      });
      return { item: await this.item(row), secret };
    });
  }

  update(
    id: string,
    input: GenericWebhookChanges & { paused?: boolean },
  ): Promise<InboundWebhookItem> {
    return guard(async () => {
      await this.assertEnabled();
      const found = await this.manageable(id);
      // An MCP Events subscription is set up in its conversation; only its name, which is how
      // lists show it, changes here.
      if (found.kind === 'mcp_events') return this.renameSubscription(found, input);
      const row = await guard(async () => asGeneric(found));
      const { paused, ...settings } = input;
      // Pausing or resuming alone stays an administrative action.
      if (Object.values(settings).some((value) => value !== undefined)) {
        await this.assertAgentAccess(row.agentId, 'edit');
        this.assertConfigures(row);
      }
      const updated = await updateGenericWebhook(this.db, row, input);
      await this.audit('webhook.updated', updated, {
        ...(input.autoApprove !== undefined && { autoApprove: input.autoApprove }),
        ...(input.delivery !== undefined && { channelId: input.delivery?.channelId ?? null }),
        ...(paused !== undefined && { paused }),
      });
      return this.item(updated);
    });
  }

  private async renameSubscription(
    row: InboundWebhookView,
    input: GenericWebhookChanges & { paused?: boolean },
  ) {
    const { name, ...rest } = input;
    if (Object.values(rest).some((value) => value !== undefined))
      throw new InboundWebhookManageError(
        'bad_request',
        'Only the name of an MCP Events subscription can be changed; ask the agent to subscribe again to change the rest.',
      );
    if (name === undefined) return this.item(row);
    await this.assertAgentAccess(row.agentId, 'use');
    this.assertConfigures(row);
    // Unnamed, a subscription is shown by its event, as when it was made.
    const updated = await this.model.update(row.id, {
      name: name?.trim() || (row.kind === 'mcp_events' ? row.config.eventName : null),
    });
    if (!updated) throw notFound();
    await this.audit('webhook.updated', updated, { renamed: true });
    return this.item(updated);
  }

  /** Remove a webhook of any kind; an MCP Events subscription is also ended on its server. */
  delete(id: string): Promise<{ success: true }> {
    return guard(async () => {
      const row = await this.model.findById(id);
      if (!row || row.status === 'deleting') throw notFound();
      if (!canManageInboundWebhook(this.scope, row))
        throw new InboundWebhookManageError(
          'forbidden',
          'Only the creator or a workspace owner or admin can delete this webhook.',
        );
      await removeInboundWebhook(this.db, row);
      await this.audit('webhook.deleted', row);
      return { success: true as const };
    });
  }

  /** Issue a new key, shown this once; the old key stops working at once and the URL stays. */
  rotateKey(id: string): Promise<InboundWebhookItemWithSecret> {
    return guard(async () => {
      const row = await this.manageableGeneric(id);
      await this.assertAgentAccess(row.agentId, 'edit');
      this.assertConfigures(row);
      const rotated = await rotateGenericWebhookToken(this.db, row);
      await this.audit('webhook.updated', rotated.row, { rotatedToken: true });
      return { item: await this.item(rotated.row), secret: rotated.secret };
    });
  }

  /** Run a sample request through the real receiver, so the Agent wakes as it would for a caller. */
  sendTest(id: string) {
    return guard(async () => {
      const row = await this.manageableGeneric(id);
      await this.assertAgentAccess(row.agentId, 'edit');
      this.assertConfigures(row);
      return sendGenericWebhookTest(this.db, row);
    });
  }

  /** A webhook's calls, newest first; only its managers see what callers sent. */
  listDeliveries(
    id: string,
    cursor?: { createdAt: string; id: string },
  ): Promise<InboundWebhookDeliveryPage> {
    return guard(async () => {
      const row = await this.model.findById(id);
      if (!row || !canManageInboundWebhook(this.scope, row)) throw notFound();
      await this.assertAgentAccess(row.agentId, 'use');
      return listInboundWebhookDeliveries(this.db, row, cursor);
    });
  }

  /**
   * Whether results can still reach the Channel a row posts to, checked as its creator: a check
   * reports `channel_unavailable` before the next event finds out, and clears it once the Channel
   * takes posts again.
   */
  private async checkChannelDelivery(model: InboundWebhookModel, row: InboundWebhookView) {
    const delivery = row.config.delivery;
    if (!delivery) return;
    let available = true;
    try {
      await assertChannelDelivery(
        this.db,
        { userId: row.userId, workspaceId: row.workspaceId ?? undefined },
        row.agentId,
        delivery,
      );
    } catch (error) {
      if (!(error instanceof ChannelDeliveryError)) throw error;
      available = false;
    }
    const current = await model.findById(row.id);
    if (!current) return;
    if (!available && !current.lastError)
      await model.update(row.id, { lastError: 'channel_unavailable' });
    else if (available && current.lastError === 'channel_unavailable')
      await model.update(row.id, { lastError: null });
  }

  /** Check an MCP Events subscription with its server now, renewing or recovering it. */
  check(id: string): Promise<InboundWebhookItem> {
    return guard(async () => {
      const row = await this.manageable(id);
      const kind = getInboundWebhookKind(row.kind);
      if (!kind?.maintain)
        throw new InboundWebhookManageError(
          'bad_request',
          'This automation does not support checking.',
        );
      if (!(await kind.isEnabled(row.userId)))
        // The caller's own feature may be on; it is the owner's that is off.
        throw new InboundWebhookManageError(
          'forbidden',
          'MCP Events is disabled for this subscription owner.',
        );
      if (!(await redisService.inboundWebhook.claimCheck(row.id)))
        throw new InboundWebhookManageError(
          'rate_limited',
          'Wait 30 seconds before checking again.',
        );
      // A workspace admin may maintain a colleague's endpoint using its creator's credentials.
      const model = new InboundWebhookModel(
        this.db,
        row.userId,
        row.workspaceId ?? undefined,
        await KeyVaultsGateKeeper.initWithEnvKey(),
      );
      await kind.maintain({ db: this.db, featureEnabled: true, model, row });
      await this.checkChannelDelivery(model, row);
      const updated = await model.findById(row.id);
      if (!updated || updated.status === 'deleting') throw notFound();
      return this.item(updated);
    });
  }
}
