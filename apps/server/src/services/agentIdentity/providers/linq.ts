import type {
  LinqInboundMessage,
  LinqMessagePart,
  LinqWebhookDedupeStore,
  LinqWebhookEvent,
  LinqWebhookSignatureHeaders,
} from '@lobechat/agent-address-linq';
import {
  createInMemoryLinqWebhookDedupeStore,
  LinqApiClient,
  LinqWebhookDeduplicator,
  markdownToPlainText,
  verifyLinqWebhookSignature,
} from '@lobechat/agent-address-linq';
import type {
  AgentAccountAttachment,
  AgentAccountInboundEvent,
  AgentAccountInboundMessage,
  AgentAccountInboundRequest,
  AgentAccountOutboundMessage,
  AgentAccountProvider,
  AgentAccountProvisionInput,
  AgentAccountProvisionResult,
  AgentAccountRef,
} from '@lobechat/types';

import { AgentAccountError } from '../errors';

/** Server-side configuration for the Linq (iMessage / SMS) provider. */
export interface LinqProviderConfig {
  /** REST base override. Defaults to the package's `https://api.linqapp.com/v3`. */
  apiBaseUrl?: string;
  /** Linq partner API key. */
  apiKey: string;
  /** Multi-instance replay store; defaults to the package's in-memory store. */
  dedupeStore?: LinqWebhookDedupeStore;
  /**
   * The operator's Linq number pool, in E.164. Linq numbers are carrier
   * inventory rather than something the REST API mints, so provisioning binds
   * the first free number to the agent. One number backs one live account — a
   * deployment opens as many phone accounts as it has numbers.
   */
  fromNumbers?: string[];
  /** Injectable clock, in milliseconds (signature tolerance, `receivedAt` fallback). */
  now?: () => number;
  /** Shared Linq webhook signing secret (`whsec_…`). */
  webhookSecret?: string;
}

/**
 * Process-wide default replay store. The deployment builds a fresh registry —
 * and so a fresh provider — for every webhook request, so a store created per
 * provider would forget each claim as soon as the request ended.
 */
const defaultDedupeStore = createInMemoryLinqWebhookDedupeStore();

/** The only event that carries a message a human sent to the number. */
const INBOUND_EVENT_TYPE = 'message.received';

const parse = <T>(body: string): T | undefined => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** The human's handle, across the shapes Linq serializes a sender in. */
const senderHandle = (data: LinqInboundMessage): string | undefined => {
  const handle = data.sender_handle?.handle;
  if (handle) return handle;
  if (typeof data.sender === 'string') return asString(data.sender);
  return data.sender?.handle;
};

/** A Linq message is made of parts; only the text parts carry prose. */
const partsToText = (parts: LinqMessagePart[] | undefined): string =>
  (parts ?? [])
    .filter((part): part is Extract<LinqMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.value)
    .join('\n')
    .trim();

/** Media parts are only usable downstream when Linq hosts the bytes at a URL. */
const partsToAttachments = (parts: LinqMessagePart[] | undefined): AgentAccountAttachment[] =>
  (parts ?? [])
    .filter(
      (part): part is Extract<LinqMessagePart, { type: 'media' }> =>
        part.type === 'media' && !!part.url,
    )
    .map((part) => ({ mimeType: 'application/octet-stream', url: part.url! }));

/**
 * The Linq provider: an agent's own `phone` address on LobeHub's carrier
 * account.
 *
 * Linq is a carrier, not a social platform, so there is no per-agent bot
 * registration and nothing here models threads/typing as platform features —
 * inbound is normalized to the same message shape every other provider
 * produces.
 */
export const createLinqProvider = (config: LinqProviderConfig): AgentAccountProvider<'phone'> => {
  const pool = config.fromNumbers ?? [];
  const deduplicator = new LinqWebhookDeduplicator(config.dedupeStore ?? defaultDedupeStore);

  return {
    /** A phone number can receive and send. */
    capabilities: { receive: true, send: true },
    kind: 'phone',
    provider: 'linq',

    provision: async (input: AgentAccountProvisionInput): Promise<AgentAccountProvisionResult> => {
      if (pool.length === 0) {
        throw new Error(
          'Linq provisioning needs an operator-provisioned number: set LINQ_FROM_NUMBER ' +
            '(or pass fromNumbers to createLinqProvider) before opening a phone account.',
        );
      }

      for (const number of pool) {
        if (input.isIdentifierHeld && (await input.isIdentifierHeld(number))) continue;
        return { identifier: number, metadata: { number } };
      }

      throw new AgentAccountError(
        'capacity_exhausted',
        `All ${pool.length} phone number(s) on this deployment are already in use by other ` +
          'agents. Release a phone account or ask the operator to add a number.',
      );
    },

    release: async (_ref: AgentAccountRef): Promise<void> => {
      // Linq numbers are carrier inventory owned by the deployment and the REST
      // API exposes no release; revoking the account drops the binding locally.
      // Releasing the number itself is an operator action.
    },

    releaseInbound: (eventId: string): Promise<void> => deduplicator.release(eventId),

    send: async (
      ref: AgentAccountRef,
      message: AgentAccountOutboundMessage,
    ): Promise<{ providerMessageId: string }> => {
      const fromNumber = asString(ref.metadata?.number) ?? ref.identifier;
      const client = new LinqApiClient({
        apiKey: config.apiKey,
        baseUrl: config.apiBaseUrl,
        fromNumber,
      });

      const sent = await client.sendToHandle({
        handle: message.to,
        // Linq delivers text verbatim, so markdown has to be degraded first.
        text: markdownToPlainText(message.text),
      });

      return { providerMessageId: sent.message?.id ?? '' };
    },

    resolveInboundIdentifier: (request: AgentAccountInboundRequest): string | undefined => {
      const event = parse<LinqWebhookEvent>(request.body);
      if (!event) return undefined;

      const data = (event.data ?? {}) as Record<string, unknown>;
      // The number the delivery was addressed to is the routing key. Field
      // naming has moved across Linq API versions, so accept the known
      // spellings and fall back to the deployment's number only when there is
      // exactly one — with a pool, guessing would deliver to the wrong agent.
      return (
        asString(data.to) ??
        asString(data.phone_number) ??
        asString(data.recipient) ??
        asString(event.to) ??
        asString(event.phone_number) ??
        (pool.length === 1 ? pool[0] : undefined)
      );
    },

    verifyInbound: async (
      request: AgentAccountInboundRequest,
      ref: AgentAccountRef,
    ): Promise<AgentAccountInboundEvent | null> => {
      const secret = ref.credential?.webhookSecret ?? config.webhookSecret;
      if (!secret) return null;

      const headers: LinqWebhookSignatureHeaders = {
        id: request.headers['webhook-id'] ?? '',
        signature: request.headers['webhook-signature'] ?? '',
        timestamp: request.headers['webhook-timestamp'] ?? '',
      };

      const verified = verifyLinqWebhookSignature({
        body: request.body,
        headers,
        now: config.now?.(),
        secret,
      });
      // Signature first, always: claiming an id before verifying lets an
      // unauthenticated caller burn ids and suppress real deliveries.
      if (!verified.ok) return null;

      if (!headers.id) return null;

      const event = parse<LinqWebhookEvent>(request.body);
      if (!event || typeof event.event_type !== 'string') return null;

      return (await deduplicator.isDuplicate(headers.id))
        ? { duplicate: true, eventId: headers.id, payload: event }
        : { eventId: headers.id, payload: event };
    },

    normalizeInbound: async (
      event: AgentAccountInboundEvent,
      ref: AgentAccountRef,
    ): Promise<AgentAccountInboundMessage | null> => {
      const payload = event.payload as LinqWebhookEvent<LinqInboundMessage>;
      // Linq signs every event type to the same endpoint — delivery receipts,
      // reactions and the echo of our own sends included. Only a message a
      // human sent to the number is inbound; anything else would wake the agent
      // on its own outbound.
      if (payload.event_type !== INBOUND_EVENT_TYPE) return null;

      const data = payload.data;
      if (!data?.id || data.direction === 'outbound') return null;

      const text = partsToText(data.parts);
      const attachments = partsToAttachments(data.parts);
      // A photo with no caption is still a message.
      if (!text && attachments.length === 0) return null;

      return {
        attachments: attachments.length > 0 ? attachments : undefined,
        from: senderHandle(data) ?? 'unknown',
        providerMessageId: data.id,
        receivedAt: new Date(data.sent_at ?? new Date(config.now?.() ?? Date.now()).toISOString()),
        text,
        threadKey: data.chat?.id,
        to: ref.identifier,
      };
    },
  };
};
