import { createHash, randomBytes } from 'node:crypto';

import type {
  ListEventTypesState,
  ListSubscriptionsState,
  McpEventSubscriptionSummary,
  SubscribeEventArgs,
  SubscribeEventState,
} from '@lobechat/builtin-tool-mcp-events';
import { isInboundWebhookOfKind } from '@lobechat/types';
import { isLocalOrPrivateUrl } from '@lobechat/utils';
import { isPlainRecord } from '@lobechat/utils/object';
import Ajv from 'ajv';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import type { DecryptedConnector } from '@/database/models/connector';
import { ConnectorModel } from '@/database/models/connector';
import type { InboundWebhookViewOf } from '@/database/models/inboundWebhook';
import { InboundWebhookLimitError, InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { CHANNEL_TOPIC_TRIGGER } from '@/database/utils/topicVisibility';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { resolveConnectorAccount } from '@/server/services/connector/links';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { isWebhookEnabled } from '@/server/services/inboundWebhook/featureGate';
import { mcpService } from '@/server/services/mcp';
import { isPublicHttpsUrl } from '@/server/utils/publicHttpsUrl';

import { channelOriginOfRun } from '../../channelDelivery';
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

  /**
   * `channelOrigin` is asked for by subscribing only: a subscription made in a Channel run must
   * know which Channel or Thread its results go to. Discovering events and listing subscriptions
   * work in a Channel topic like in any other.
   */
  private async context(
    agentId: string,
    topicId?: string,
    channelOrigin?: { operationId?: string },
  ) {
    if (!(await isWebhookEnabled(this.userId)))
      throw new McpEventsServiceError('feature_disabled', 'MCP Events is disabled.');
    if (!(await new AgentModel(this.db, this.userId, this.workspaceId).existsById(agentId)))
      throw new McpEventsServiceError('forbidden', 'This agent is not available.');
    let channel: { channelId: string; threadId: string | null } | undefined;
    if (topicId) {
      const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findById(topicId);
      if (!topic || topic.agentId !== agentId)
        throw new McpEventsServiceError('forbidden', 'This topic is not available to this agent.');
      // A Channel run works in a hidden Topic of its own; events run there too, and their result
      // is posted back to the Channel or Thread the run answers.
      if (channelOrigin && topic.trigger === CHANNEL_TOPIC_TRIGGER) {
        const { operationId } = channelOrigin;
        channel = operationId ? await channelOriginOfRun(this.db, operationId) : undefined;
        if (!channel)
          throw new McpEventsServiceError(
            'channel_unsupported',
            'Subscribe from a message in the Channel, so events know where to post.',
          );
      }
    }
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    return {
      channel,
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
  }

  /** Credentials come from the connector's account, so this checks the resolved connector. */
  private assertAuthenticated(connector: DecryptedConnector) {
    const headers = connector.metadata?.customHeaders;
    if (!connector.credentials && !Object.keys(headers ?? {}).length)
      throw new McpEventsServiceError(
        'forbidden',
        'Authenticate this connector before subscribing to events.',
      );
  }

  private async summary(
    row: InboundWebhookViewOf<'mcp_events'>,
    connectorModel: ConnectorModel,
  ): Promise<McpEventSubscriptionSummary> {
    const connector = row.connectorId ? await connectorModel.findPublicById(row.connectorId) : null;
    return {
      arguments: row.config.arguments,
      connector: { identifier: connector?.identifier ?? '', name: connector?.name ?? '' },
      ...(row.config.delivery && {
        deliversTo: row.config.delivery.threadId ? ('thread' as const) : ('channel' as const),
      }),
      eventName: row.config.eventName,
      expiresAt: row.state.refreshBefore ?? null,
      id: row.id,
      instructions: row.instructions,
      lastError: row.lastError,
      name: row.name,
      status:
        row.status === 'pending' || row.status === 'deleting' || row.status === 'paused'
          ? 'error'
          : row.status,
    };
  }

  async listEventTypes(input: {
    agentId: string;
    connector?: string;
    topicId: string;
  }): Promise<ListEventTypesState> {
    const { connectorModel } = await this.context(input.agentId, input.topicId);
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
        const { connector: fresh } = await resolveConnectorAccount(connector, { connectorModel });
        this.assertAuthenticated(fresh);
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
    input: SubscribeEventArgs & { agentId: string; operationId?: string; topicId: string },
  ): Promise<SubscribeEventState> {
    try {
      return await this.createSubscription(input);
    } catch (error) {
      throw mapMcpEventsError(error);
    }
  }

  private async createSubscription(
    input: SubscribeEventArgs & { agentId: string; operationId?: string; topicId: string },
  ): Promise<SubscribeEventState> {
    const { channel, connectorModel, model } = await this.context(input.agentId, input.topicId, {
      operationId: input.operationId,
    });
    // In a Thread, results go to that Thread unless the agent was asked for the main timeline.
    const delivery = channel && {
      channelId: channel.channelId,
      ...(channel.threadId && input.deliverTo !== 'channel' && { threadId: channel.threadId }),
    };
    if (!isPublicHttpsUrl(appEnv.APP_URL))
      throw new McpEventsServiceError(
        'public_url_required',
        'Set APP_URL to a public HTTPS URL before subscribing.',
      );
    const [connector] = await connectorModel.resolveByIdentifiers([input.connector], input.agentId);
    if (!connector) throw new McpEventsServiceError('connector_not_found', 'Connector not found.');
    this.assertRemote(connector);
    const { connector: fresh, linkId } = await resolveConnectorAccount(connector, {
      connectorModel,
    });
    this.assertAuthenticated(fresh);
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
    // Another account of the same connector is another subscription on the server.
    const identity = JSON.stringify(
      [
        connector.id,
        input.topicId,
        input.name,
        args,
        ...(linkId ? [linkId] : []),
        ...(delivery ? [delivery] : []),
      ],
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
    const existing = (
      await model.query({ includeHidden: true, kind: 'mcp_events', topicId: input.topicId })
    )
      .filter((row) => isInboundWebhookOfKind(row, 'mcp_events'))
      .find((row) => row.userId === this.userId && row.dedupeKey === dedupeKey);
    if (existing) {
      if (existing.status === 'pending' || existing.status === 'deleting')
        throw new McpEventsServiceError(
          'limit_reached',
          'This subscription is currently being changed. Try again shortly.',
        );
      return { subscription: await this.summary(existing, connectorModel) };
    }
    const secret = `whsec_${randomBytes(32).toString('base64')}`;
    let row: InboundWebhookViewOf<'mcp_events'>;
    try {
      row = (await model.createWithLimits({
        agentId: input.agentId,
        config: {
          arguments: args,
          ...(delivery && { delivery }),
          eventName: input.name,
          ...(linkId && { linkId }),
        },
        connectorId: connector.id,
        dedupeKey,
        instructions: input.instructions,
        kind: 'mcp_events',
        // How lists show it: the user's name for it, else the event it follows.
        name: input.title?.trim().slice(0, 100) || input.name,
        secret,
        status: 'pending',
        topicId: input.topicId,
        verification: { scheme: 'standard_webhooks' },
      })) as InboundWebhookViewOf<'mcp_events'>;
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
      if (!updated || !isInboundWebhookOfKind(updated, 'mcp_events'))
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
    const rows = (await model.query({ ...input, kind: 'mcp_events' })).filter((row) =>
      isInboundWebhookOfKind(row, 'mcp_events'),
    );
    return {
      subscriptions: await pMap(rows, (row) => this.summary(row, connectorModel), {
        concurrency: 5,
      }),
    };
  }
}
