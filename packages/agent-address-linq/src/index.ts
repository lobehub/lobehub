/**
 * Linq transport — the provider behind an agent's own `phone` address.
 *
 * Linq is a carrier (iMessage / SMS), not a social platform: this package owns
 * the REST client, Standard Webhooks verification + replay dedupe, and the
 * markdown → plain-text degradation Linq requires. There is no chat-SDK
 * adapter here, and no per-agent bot registration — the number is shared
 * infrastructure, the agent merely owns an address on it.
 */
export {
  assertSendableParts,
  LINQ_MAX_PARTS,
  LINQ_URL_MEDIA_MAX_BYTES,
  LinqApiClient,
} from './api';
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
