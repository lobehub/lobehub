/**
 * Agent Mail (lobe.id) transport — the provider behind an agent's own `mail`
 * address.
 *
 * This package knows only how to talk to Agent Mail and how to turn an email
 * into a normalized message: REST client, webhook signature verification, raw
 * header loop protection, quoted-history stripping, and markdown → HTML/text
 * rendering. It deliberately implements **no** chat-SDK adapter and carries no
 * platform identity/thread/typing semantics — an agent's address is its own,
 * not a bot inside someone else's platform.
 */
export {
  computeAgentMailSignature,
  DEFAULT_API_BASE_URL,
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  LobeMailApiClient,
  LobeMailApiError,
  parseAgentMailSignature,
  verifyAgentMailSignature,
} from './api';
export {
  checkInboundEmail,
  type IgnoreDecision,
  type IgnoreReason,
  parseRawHeaders,
} from './loop-guard';
export { markdownToHtml, markdownToPlainText } from './markdown';
export { stripQuotedReply } from './quotes';
export type {
  EmailAddress,
  EmailInbox,
  EmailMessageDetail,
  EmailMessageSummary,
  EmailRawMessage,
  EmailWebhook,
  EmailWebhookEvent,
} from './types';
