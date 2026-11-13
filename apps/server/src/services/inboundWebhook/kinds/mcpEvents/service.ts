import { createHash, randomBytes } from 'node:crypto';

import type {
  ListEventTypesState,
  ListSubscriptionsState,
  McpEventSubscriptionSummary,
  SubscribeEventArgs,
  SubscribeEventState,
  UnsubscribeEventState,
} from '@lobechat/builtin-tool-mcp-events';
import { isLocalOrPrivateUrl } from '@lobechat/utils';
import { isPlainRecord } from '@lobechat/utils/object';
import Ajv from 'ajv';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import type { DecryptedConnector } from '@/database/models/connector';
import { ConnectorModel } from '@/database/models/connector';
import type { InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookLimitError, InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';
import { isMcpEventsEnabled } from '@/server/services/mcp/featureGate';
import { isPublicHttpsUrl } from '@/server/utils/publicHttpsUrl';

import { removeInboundWebhook } from '../../lifecycle';
import { mapMcpEventsError, McpEventsServiceError } from './errors';
import { applySubscriptionResult, callbackUrl, subscribeRemote } from './subscription';

export { McpEventsServiceError } from './errors';

export class McpEventsService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  private async context(agentId: string, topicId?: string) {
    if (!(await isMcpEventsEnabled(this.userId)))
      throw new McpEventsServiceError('feature_disabled', 'MCP Events is disabled.');
    if (!(await new AgentModel(this.db, this.userId, this.workspaceId).existsById(agentId)))
      throw new McpEventsServiceError('forbidden', 'This agent is not available.');
    if (topicId) {
      const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
      if (!topic || topic.agentId !== agentId)
        throw new McpEventsServiceError('forbidden', 'This topic is not available to this agent.');
    }
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    return {
      connectorModel: new ConnectorModel(this.db, this.userId, this.workspaceId, gateKeeper),
      model: new InboundWebhookModel(this.db, this.userId, this.workspaceId, gateKeeper),
    };
  }

  private assertRemote(connector: DecryptedConnector) {
    if (!connector.isEnabled)
      throw new McpEventsServiceError('forbidden', 'This connector is disabled.');
    if (
      connector.mcpConnectionType === 'stdio' ||
      !connector.mcpServerUrl ||
      isLocalOrPrivateUrl(connector.mcpServerUrl)
    )
      throw new McpEventsServiceError(
        'events_unsupported',
        'Event subscriptions require a remote HTTP connector.',
      );
    const headers = connector.metadata?.customHeaders;
    if (!connector.credentials && !Object.keys(headers ?? {}).length)
      throw new McpEventsServiceError(
        'forbidden',
        'Authenticate this connector before subscribing to events.',
      );
  }

  private async summary(
    row: InboundWebhookView,
    connectorModel: ConnectorModel,
  ): Promise<McpEventSubscriptionSummary> {
    const connector = row.connectorId ? await connectorModel.findPublicById(row.connectorId) : null;
    return {
      arguments: row.config.arguments,
      connector: { identifier: connector?.identifier ?? '', name: connector?.name ?? '' },
      eventName: row.config.eventName,
      expiresAt: row.state.refreshBefore ?? null,
      id: row.id,
      instructions: row.instructions,
      lastError: row.lastError,
      status: row.status === 'pending' || row.status === 'deleting' ? 'error' : row.status,
    };
  }

  async listEventTypes(input: {
    agentId: string;
    connector?: string;
  }): Promise<ListEventTypesState> {
    const { connectorModel } = await this.context(input.agentId);
    const connectors = input.connector
      ? await connectorModel.resolveByIdentifiers([input.connector], input.agentId)
      : await connectorModel.resolveAll(input.agentId);
    if (input.connector && !connectors.length)
      throw new McpEventsServiceError('connector_not_found', 'Connector not found.');
    const result: ListEventTypesState = { eventTypes: [] };
    for (const connector of connectors) {
      if (!connector.isEnabled || !connector.metadata?.capabilities?.events?.supported) continue;
      try {
        this.assertRemote(connector);
        const fresh = await ensureFreshConnectorToken(connector, connectorModel);
        const events = await mcpService.listEvents(buildConnectorMcpParams(fresh));
        result.eventTypes.push(
          ...events.map((event) => ({
            connector: { identifier: connector.identifier, name: connector.name },
            description: event.description,
            inputSchema: event.inputSchema,
            name: event.name,
            subscribable: event.delivery.includes('webhook'),
          })),
        );
      } catch (error) {
        result.errors ??= [];
        result.errors.push({
          connector: connector.identifier,
          message: mapMcpEventsError(error).message,
        });
      }
    }
    return result;
  }

  async subscribeEvent(
    input: SubscribeEventArgs & { agentId: string; topicId: string },
  ): Promise<SubscribeEventState> {
    try {
      return await this.createSubscription(input);
    } catch (error) {
      throw mapMcpEventsError(error);
    }
  }

  private async createSubscription(
    input: SubscribeEventArgs & { agentId: string; topicId: string },
  ): Promise<SubscribeEventState> {
    const { connectorModel, model } = await this.context(input.agentId, input.topicId);
    if (!isPublicHttpsUrl(appEnv.APP_URL))
      throw new McpEventsServiceError(
        'public_url_required',
        'Set APP_URL to a public HTTPS URL before subscribing.',
      );
    const [connector] = await connectorModel.resolveByIdentifiers([input.connector], input.agentId);
    if (!connector) throw new McpEventsServiceError('connector_not_found', 'Connector not found.');
    this.assertRemote(connector);
    const fresh = await ensureFreshConnectorToken(connector, connectorModel);
    const params = buildConnectorMcpParams(fresh);
    if (!(await mcpService.getEventsCapability(params)).supported)
      throw new McpEventsServiceError(
        'events_unsupported',
        'This connector does not support events.',
      );
    const event = (await mcpService.listEvents(params)).find((event) => event.name === input.name);
    if (!event) throw new McpEventsServiceError('events_unsupported', 'Event type not found.');
    if (!event.delivery.includes('webhook'))
      throw new McpEventsServiceError(
        'delivery_unsupported',
        'This event does not support webhook delivery.',
      );
    const args = input.arguments ?? {};
    if (event.inputSchema) {
      const ajv = new Ajv({ strict: false, validateFormats: false });
      if (!ajv.validate(event.inputSchema, args))
        throw new McpEventsServiceError(
          'invalid_arguments',
          'Arguments do not match the event input schema.',
        );
    }
    const identity = JSON.stringify(
      [connector.id, input.topicId, input.name, args],
      (_key, value: unknown) =>
        isPlainRecord(value)
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((key) => [key, value[key]]),
            )
          : value,
    );
    const dedupeKey = createHash('sha256').update(identity).digest('hex');
    const existing = (await model.query({ includeHidden: true, topicId: input.topicId })).find(
      (row) => row.userId === this.userId && row.dedupeKey === dedupeKey,
    );
    if (existing) {
      if (existing.status === 'pending' || existing.status === 'deleting')
        throw new McpEventsServiceError(
          'limit_reached',
          'This subscription is currently being changed. Try again shortly.',
        );
      return { subscription: await this.summary(existing, connectorModel) };
    }
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    let row: InboundWebhookView;
    try {
      row = await model.createWithLimits({
        agentId: input.agentId,
        config: { arguments: args, eventName: input.name },
        connectorId: connector.id,
        dedupeKey,
        instructions: input.instructions,
        kind: 'mcp_events',
        name: input.name,
        secret,
        status: 'pending',
        topicId: input.topicId,
        verification: { scheme: 'standard_webhooks' },
      });
    } catch (error) {
      if (error instanceof InboundWebhookLimitError)
        throw new McpEventsServiceError('limit_reached', error.message);
      throw error;
    }
    try {
      const result = await subscribeRemote(params, {
        arguments: args,
        cursor: null,
        delivery: { mode: 'webhook', secret, url: callbackUrl(row.id) },
        name: input.name,
        ttlMs: null,
      });
      await applySubscriptionResult({ db: this.db, model, row }, result);
      if (this.workspaceId)
        await new WorkspaceAuditLogModel(this.db).create({
          action: 'webhook.created',
          metadata: { direction: 'inbound', kind: row.kind },
          resourceId: row.id,
          resourceType: 'webhook',
          userId: this.userId,
          workspaceId: this.workspaceId,
        });
      const updated = await model.findById(row.id);
      if (!updated)
        throw new McpEventsServiceError(
          'not_found',
          'This subscription was removed while it was being created.',
        );
      return { subscription: await this.summary(updated, connectorModel) };
    } catch (error) {
      // Even a failed handshake can have registered the remote endpoint. Hide and teardown before forgetting it.
      await removeInboundWebhook(this.db, row);
      throw mapMcpEventsError(error);
    }
  }

  async listSubscriptions(input: {
    agentId: string;
    topicId: string;
  }): Promise<ListSubscriptionsState> {
    const { connectorModel, model } = await this.context(input.agentId, input.topicId);
    const rows = await model.query(input);
    return {
      subscriptions: await pMap(rows, (row) => this.summary(row, connectorModel), {
        concurrency: 5,
      }),
    };
  }

  async unsubscribeEvent(input: {
    agentId: string;
    topicId: string;
    subscriptionId: string;
  }): Promise<UnsubscribeEventState> {
    const { model } = await this.context(input.agentId, input.topicId);
    const row = await model.findById(input.subscriptionId);
    // A topic-bound runtime must not manage another topic's triggers or another member's credentials.
    if (
      !row ||
      row.topicId !== input.topicId ||
      row.agentId !== input.agentId ||
      row.userId !== this.userId
    )
      throw new McpEventsServiceError('not_found', 'Subscription not found in this topic.');
    await removeInboundWebhook(this.db, row);
    if (this.workspaceId)
      await new WorkspaceAuditLogModel(this.db).create({
        action: 'webhook.deleted',
        metadata: { direction: 'inbound', kind: row.kind },
        resourceId: row.id,
        resourceType: 'webhook',
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
    return { removed: true, subscriptionId: row.id };
  }
}
