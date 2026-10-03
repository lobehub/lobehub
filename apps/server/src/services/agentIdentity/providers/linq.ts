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

/** Server-side configuration for the Linq (iMessage / SMS) provider. */
export interface LinqProviderConfig {
  /** REST base override. Defaults to the package's `https://api.linqapp.com/v3`. */
  apiBaseUrl?: string;
  /** Linq partner API key. */
  apiKey: string;
  /** Multi-instance replay store; defaults to the package's in-memory store. */
  dedupeStore?: LinqWebhookDedupeStore;
  /**
   * An operator-provisioned Linq number in E.164. Linq numbers are carrier
   * inventory rather than something the REST API mints, so provisioning binds
   * this number to the agent. One number backs one account — a deployment that
   * wants a number per agent provisions one per agent.
   */
  fromNumber?: string;
  /** Injectable clock, in milliseconds (signature tolerance, `receivedAt` fallback). */
  now?: () => number;
  /** Shared Linq webhook signing secret (`whsec_…`). */
  webhookSecret?: string;
}

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
  const deduplicator = new LinqWebhookDeduplicator(
    config.dedupeStore ?? createInMemoryLinqWebhookDedupeStore(),
  );

  return {
    /** A phone number can receive and send. */
    capabilities: { receive: true, send: true },
    kind: 'phone',
    provider: 'linq',

    provision: async (_input: AgentAccountProvisionInput): Promise<AgentAccountProvisionResult> => {
      const number = config.fromNumber;
      if (!number) {
        throw new Error(
          'Linq provisioning needs an operator-provisioned number: set LINQ_FROM_NUMBER ' +
            '(or pass fromNumber to createLinqProvider) before opening a phone account.',
        );
      }

      return { identifier: number, metadata: { number } };
    },

    release: async (_ref: AgentAccountRef): Promise<void> => {
      // Linq numbers are carrier inventory owned by the deployment and the REST
      // API exposes no release; revoking the account drops the binding locally.
      // Releasing the number itself is an operator action.
    },

    send: async (
      ref: AgentAccountRef,
      message: AgentAccountOutboundMessage,
    ): Promise<{ providerMessageId: string }> => {
      const fromNumber = asString(ref.metadata?.number) ?? config.fromNumber;
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
      // spellings and fall back to the deployment's configured number — a
      // single-number deployment routes every delivery to that one account.
      return (
        asString(data.to) ??
        asString(data.phone_number) ??
        asString(data.recipient) ??
        asString(event.to) ??
        asString(event.phone_number) ??
        config.fromNumber
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

      if (!headers.id || (await deduplicator.isDuplicate(headers.id))) return null;

      const event = parse<LinqWebhookEvent>(request.body);
      if (!event || typeof event.event_type !== 'string') return null;

      return { eventId: headers.id, payload: event };
    },

    normalizeInbound: async (
      event: AgentAccountInboundEvent,
      ref: AgentAccountRef,
    ): Promise<AgentAccountInboundMessage | null> => {
      const payload = event.payload as LinqWebhookEvent<LinqInboundMessage>;
      const data = payload.data;
      if (!data?.id) return null;

      const text = partsToText(data.parts);
      if (!text) return null;

      const attachments = partsToAttachments(data.parts);

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
