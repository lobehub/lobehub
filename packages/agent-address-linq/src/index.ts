/**
 * Linq transport — LobeHub's shared iMessage / SMS number pool.
 *
 * Linq is a carrier (iMessage / SMS), not a social platform: this package owns
 * the REST client, Standard Webhooks verification + replay dedupe, the
 * markdown → plain-text degradation Linq requires, and the link-code / deep
 * link primitives a person uses to start a conversation. The numbers are shared
 * infrastructure — no agent or user owns one; the messenger routes each
 * inbound message by its sender.
 */
export {
  assertSendableParts,
  LINQ_MAX_PARTS,
  LINQ_URL_MEDIA_MAX_BYTES,
  LinqApiClient,
} from './api';
export type { LinqDeepLink, LinqDeepLinkInput, LinqNumberOptions } from './deep-link';
export {
  buildLinqDeepLink,
  createLinqLinkCode,
  extractLinqLinkCode,
  LINQ_LINK_CODE_ALPHABET,
  LINQ_LINK_CODE_LENGTH,
  LINQ_LINK_CODE_PATTERN,
  LINQ_LINK_CODE_PREFIX,
  normalizeLinqNumber,
} from './deep-link';
export { markdownToPlainText } from './format-converter';
export type {
  LinqApiConfig,
  LinqAttachmentCreateResponse,
  LinqChat,
  LinqChatCreateResponse,
  LinqChatListResponse,
  LinqInboundMessage,
  LinqLinkPart,
  LinqMediaPart,
  LinqMessageContent,
  LinqMessagePart,
  LinqMessageSendResponse,
  LinqOutboundAttachment,
  LinqSendOptions,
  LinqSentMessage,
  LinqTextPart,
  LinqWebhookEvent,
  LinqWebhookSignatureHeaders,
} from './types';
export { LINQ_DEFAULT_BASE_URL } from './types';
export type {
  InMemoryLinqWebhookDedupeStoreOptions,
  LinqWebhookDedupeStore,
  LinqWebhookGateOptions,
  LinqWebhookGateResult,
  LinqWebhookSignatureFailure,
  LinqWebhookSignatureOptions,
} from './webhook';
export {
  createInMemoryLinqWebhookDedupeStore,
  LINQ_WEBHOOK_ID_TTL_SECONDS,
  LINQ_WEBHOOK_TOLERANCE_SECONDS,
  LinqWebhookDeduplicator,
  signLinqWebhookPayload,
  verifyLinqWebhookRequest,
  verifyLinqWebhookSignature,
} from './webhook';
