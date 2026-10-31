import type { LinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import { createInMemoryLinqWebhookDedupeStore } from '@lobechat/agent-address-linq';
import type { EmailMessageDetail, EmailWebhookEvent } from '@lobechat/agent-address-mail';
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

import { AgentAccountError } from '../errors';

/** Server-side configuration for the Agent Mail (`lobe.id`) provider. */
export interface AgentMailProviderConfig {
  /** REST base override. Defaults to the package's `https://api.lobe.id`. */
  apiBaseUrl?: string;
  /** Agent Mail API key (`am_…`). */
  apiKey: string;
  /**
   * Replay store keyed by webhook event id. The claim-store shape is
   * transport-neutral, so the bounded in-memory store Linq ships is reused as
   * the single-process default; the deployment registry injects the shared
   * Redis-backed one.
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

  /**
   * Answer `providerMessageId` as the account behind `ref`.
   *
   * The reply route acts on the inbox that owns the message, not on the inbox
   * the caller asked us to send from — and one deployment API key spans every
   * inbox. Replying to an id from another account would therefore speak as that
   * account, skipping the lifecycle and capability checks this call already
   * passed for `ref`. The target is resolved first and refused unless it lives
   * in this account's inbox.
   */
  const replyInOwningInbox = async (
    ref: AgentAccountRef,
    providerMessageId: string,
    text: string,
  ): Promise<EmailMessageDetail> => {
    const inboxId = inboxIdOf(ref);
    const target = await client.getMessage(providerMessageId);
    if (target.inboxId !== inboxId) {
      throw new AgentAccountError(
        'reply_target_not_owned',
        `Message ${providerMessageId} belongs to another agent's inbox, so it cannot be ` +
          `answered as ${inboxId}. Reply from the account that received it.`,
      );
    }

    return client.replyToMessage(providerMessageId, { text });
  };

  return {
    /** A mailbox can receive and send, and nothing else today. */
    capabilities: { receive: true, send: true },
    kind: 'mail',
    provider: 'agent-mail',

    provision: async (input: AgentAccountProvisionInput): Promise<AgentAccountProvisionResult> => {
      // `clientId` is the mail API's idempotency key: a retry for the same agent
      // gets the inbox it already opened instead of a second, billable one.
      const inbox = await client.createInbox({
        clientId: input.agentId,
        displayName: input.displayName,
        endUserId: input.agentId,
      });
      const identity: AgentAccountProvisionResult = {
        identifier: inbox.address,
        metadata: { clientId: inbox.clientId ?? null, inboxId: inbox.id },
      };

      // A live row already routes on this inbox: an earlier attempt committed
      // and only its response was lost. That row holds the webhook secret, so
      // registering again would only mint a second webhook whose secret nothing
      // stores. Hand back the inbox; the service reconciles to the live row.
      if (await input.isIdentifierHeld?.(inbox.address)) return identity;

      let credential: Record<string, string> | undefined;
      let credentialHint: AgentAccountProvisionResult['credentialHint'];

      if (config.webhookUrl) {
        let webhook: Awaited<ReturnType<typeof client.createWebhook>>;
        try {
          webhook = await client.createWebhook({ inboxId: inbox.id, url: config.webhookUrl });
        } catch (error) {
          // The inbox already exists but nothing will ever point at it: the
          // service only learns about an account once provision returns. Hand
          // it back here, or every retry during a webhook outage leaks one.
          await client.deleteInbox(inbox.id).catch(() => undefined);
          throw error;
        }
        if (webhook.secret) {
          credential = { webhookSecret: webhook.secret };
          credentialHint = { masked: maskSecret(webhook.secret) };
        }
      }

      return { ...identity, credential, credentialHint };
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
      // Answering a specific message goes through the reply route: the mail API
      // threads it (`In-Reply-To`/`References`, recipients inherited), while
      // `sendMessage` would open a second conversation carrying the same subject
      // and drop the human's thread. `threadKey` is the RFC root key, which is
      // not a message id, so it cannot address the reply.
      const detail = message.replyToProviderMessageId
        ? await replyInOwningInbox(ref, message.replyToProviderMessageId, message.text)
        : await client.sendMessage(inboxIdOf(ref), {
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

      const accepted = {
        eventId: event.id,
        occurredAt: event.createdAt ? new Date(event.createdAt) : undefined,
        payload: event,
        type: event.type,
      };
      return fresh ? accepted : { ...accepted, duplicate: true };
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
      let detail: Awaited<ReturnType<typeof client.getMessage>>;
      try {
        detail = await client.getMessage(summaryId);
      } catch (error) {
        // The event id was claimed in verifyInbound. Give it back so the
        // provider's retry is processed rather than acknowledged as a
        // duplicate — otherwise one transient fetch failure drops the email.
        await dedupeStore.release?.(event.eventId);
        throw error;
      }
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

      // The mail API serves attachment bytes only behind the deployment's API
      // key, so the URL is that endpoint: it names the message and index the
      // bytes are retrieved by, rather than a link anyone can open.
      const attachments = (detail.attachments ?? []).map((attachment) => ({
        mimeType: attachment.contentType || 'application/octet-stream',
        name: attachment.filename ?? undefined,
        size: attachment.size,
        url: `${client.baseUrl}/v1/messages/${encodeURIComponent(detail.id)}/attachments/${attachment.index}`,
      }));

      const addresses = (list: Array<{ address: string; name?: string }> | null | undefined) =>
        (list ?? []).map(({ address, name }) => (name ? { address, name } : { address }));

      return {
        attachments: attachments.length > 0 ? attachments : undefined,
        from,
        mail: {
          attachments: (detail.attachments ?? []).map((attachment) => ({
            contentType: attachment.contentType,
            filename: attachment.filename ?? undefined,
            index: attachment.index,
            size: attachment.size,
          })),
          cc: addresses(detail.cc),
          fromName: detail.from?.name || undefined,
          inReplyTo: detail.inReplyTo ?? undefined,
          messageId: detail.messageId ?? undefined,
          references: detail.references ?? [],
          replyTo: addresses(detail.replyTo),
          to: addresses(detail.to),
        },
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
