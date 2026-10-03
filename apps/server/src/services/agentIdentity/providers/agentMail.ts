import type { LinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import { createInMemoryLinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import type { EmailWebhookEvent } from '@lobechat/agent-address-mail';
import {
  checkInboundEmail,
  LobeMailApiClient,
  LobeMailApiError,
  parseRawHeaders,
  stripQuotedReply,
  verifyAgentMailSignature,
} from '@lobechat/agent-address-mail';
import type {
  AgentAccountInboundEvent,
  AgentAccountInboundMessage,
  AgentAccountInboundRequest,
  AgentAccountOutboundMessage,
  AgentAccountProvider,
  AgentAccountProvisionInput,
  AgentAccountProvisionResult,
  AgentAccountRef,
} from '@lobechat/types';

/** Server-side configuration for the Agent Mail (`lobe.id`) provider. */
export interface AgentMailProviderConfig {
  /** REST base override. Defaults to the package's `https://api.lobe.id`. */
  apiBaseUrl?: string;
  /** Agent Mail API key (`am_…`). */
  apiKey: string;
  /**
   * Replay store keyed by webhook event id. The claim-store shape is
   * transport-neutral, so the bounded in-memory store Linq ships is reused as
   * the single-process default; a multi-instance deployment injects a shared one.
   */
  dedupeStore?: LinqWebhookDedupeStore;
  /** Injected fetch, for tests and offline acceptance. */
  fetchImpl?: typeof fetch;
  /**
   * Shared webhook signing secret. Used only when the account itself carries no
   * per-inbox secret; a per-account secret always wins.
   */
  webhookSecret?: string;
  /**
   * Public HTTPS endpoint to register for this inbox. When present, provisioning
   * also creates the webhook and stores its one-time secret as the account
   * credential. Without a reachable public URL there is nothing to register, so
   * provisioning stays inbox-only.
   */
  webhookUrl?: string;
}

const parse = <T>(body: string): T | undefined => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};

/** Mask a secret for the non-secret hint — enough to tell two apart, never to use. */
const maskSecret = (secret: string): string =>
  secret.length <= 4 ? '••••' : `••••${secret.slice(-4)}`;

/**
 * How long an accepted event id is remembered. Comfortably wider than the
 * signature tolerance, so a captured delivery cannot be replayed while its
 * signature still verifies.
 */
const EVENT_ID_TTL_SECONDS = 24 * 60 * 60;

/**
 * Process-wide default replay store. The deployment builds a fresh registry —
 * and so a fresh provider — for every webhook request, so a store created per
 * provider would forget each claim as soon as the request ended.
 */
const defaultDedupeStore = createInMemoryLinqWebhookDedupeStore();

const messageIdOf = (detail: { id?: string } | null | undefined): string => detail?.id ?? '';

/**
 * The Agent Mail (`lobe.id`) provider: an agent's own `mail` address.
 *
 * Thin by design — every byte of protocol work (REST, signature over the raw
 * body, quoted-history stripping, loop protection) already lives in
 * `@lobechat/agent-address-mail`. This layer only translates the provider
 * contract into those calls and declares what a mail account can do.
 */
export const createAgentMailProvider = (
  config: AgentMailProviderConfig,
): AgentAccountProvider<'mail'> => {
  const client = new LobeMailApiClient({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    fetchImpl: config.fetchImpl,
  });

  const dedupeStore = config.dedupeStore ?? defaultDedupeStore;

  const inboxIdOf = (ref: AgentAccountRef): string => {
    const fromMetadata = ref.metadata?.inboxId;
    return typeof fromMetadata === 'string' && fromMetadata.length > 0
      ? fromMetadata
      : ref.identifier;
  };

  return {
    /** A mailbox can receive and send, and nothing else today. */
    capabilities: { receive: true, send: true },
    kind: 'mail',
    provider: 'agent-mail',

    provision: async (input: AgentAccountProvisionInput): Promise<AgentAccountProvisionResult> => {
      const inbox = await client.createInbox({
        displayName: input.displayName,
        endUserId: input.agentId,
      });

      let credential: Record<string, string> | undefined;
      let credentialHint: AgentAccountProvisionResult['credentialHint'];

      if (config.webhookUrl) {
        const webhook = await client.createWebhook({ inboxId: inbox.id, url: config.webhookUrl });
        if (webhook.secret) {
          credential = { webhookSecret: webhook.secret };
          credentialHint = { masked: maskSecret(webhook.secret) };
        }
      }

      return {
        credential,
        credentialHint,
        identifier: inbox.address,
        metadata: { clientId: inbox.clientId ?? null, inboxId: inbox.id },
      };
    },

    release: async (ref: AgentAccountRef): Promise<void> => {
      try {
        await client.deleteInbox(inboxIdOf(ref));
      } catch (error) {
        // Release is idempotent by contract: an inbox that is already gone is
        // exactly the state a release asks for, so a retried revoke succeeds.
        if (error instanceof LobeMailApiError && error.status === 404) return;
        throw error;
      }
    },

    send: async (
      ref: AgentAccountRef,
      message: AgentAccountOutboundMessage,
    ): Promise<{ providerMessageId: string }> => {
      const detail = await client.sendMessage(inboxIdOf(ref), {
        subject: message.subject ?? '',
        text: message.text,
        to: message.to,
      });

      return { providerMessageId: messageIdOf(detail) };
    },

    resolveInboundIdentifier: (request: AgentAccountInboundRequest): string | undefined => {
      const event = parse<EmailWebhookEvent>(request.body);
      return event?.data?.inbox?.address || undefined;
    },

    verifyInbound: async (
      request: AgentAccountInboundRequest,
      ref: AgentAccountRef,
    ): Promise<AgentAccountInboundEvent | null> => {
      const secret = ref.credential?.webhookSecret ?? config.webhookSecret;
      if (!secret) return null;

      const verified = verifyAgentMailSignature({
        body: request.body,
        header: request.headers['x-agentmail-signature'],
        secret,
      });
      if (!verified) return null;

      const event = parse<EmailWebhookEvent>(request.body);
      if (!event?.id || !event.data?.message?.id) return null;

      // Signature first, then the claim: claiming before verifying would let an
      // unauthenticated caller burn ids and suppress real deliveries.
      const fresh = await dedupeStore.claim(event.id, EVENT_ID_TTL_SECONDS);

      return fresh
        ? { eventId: event.id, payload: event }
        : { duplicate: true, eventId: event.id, payload: event };
    },

    normalizeInbound: async (
      event: AgentAccountInboundEvent,
      ref: AgentAccountRef,
    ): Promise<AgentAccountInboundMessage | null> => {
      const payload = event.payload as EmailWebhookEvent;
      const inboxAddress = payload.data?.inbox?.address ?? ref.identifier;
      const summaryId = payload.data?.message?.id;
      if (!summaryId) return null;

      // The webhook carries only a summary; the body (and the raw source the
      // header-based loop guard needs) must be fetched back.
      const detail = await client.getMessage(summaryId);
      const raw = await client.getRawMessage(summaryId);
      const headers = raw ? parseRawHeaders(raw) : null;

      const from = detail.from?.address ?? '';
      const decision = checkInboundEmail({
        from,
        headers,
        inboxAddress,
        subject: detail.subject,
      });
      // Autoresponders, bounces and mailing lists are dropped at the provider
      // boundary: answering them is how an agent talks to a robot forever.
      if (decision.ignored) return null;

      return {
        from,
        providerMessageId: detail.id,
        receivedAt: new Date(detail.receivedAt),
        subject: detail.subject ?? undefined,
        text: detail.text ? stripQuotedReply(detail.text) : '',
        threadKey: detail.references?.[0] ?? detail.messageId ?? undefined,
        to: inboxAddress,
      };
    },
  };
};
