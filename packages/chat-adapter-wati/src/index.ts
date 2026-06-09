export { createWatiAdapter, WatiAdapter } from './adapter';
export {
  DEFAULT_WATI_API_BASE_URL,
  WatiApiClient,
  WatiApiError,
  type WatiWebhookEndpointsResponse,
  type WatiWebhookEndpointStatus,
} from './api';
export {
  extractPhoneListFromResponse,
  normalizePhoneDigits,
  pickWebhookPhoneValue,
  resolveWebhookPhoneNumber,
  type WatiWhatsAppPhoneEntry,
} from './phone';
export type { WatiAdapterConfig, WatiInboundMessage, WatiRawMessage, WatiThreadId } from './types';
