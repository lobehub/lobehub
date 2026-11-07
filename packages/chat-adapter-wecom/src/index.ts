export { createWeComAdapter, extractWeComText, WeComAdapter } from './adapter';
export type { WeComConnectionOptions, WeComDeliveryResult, WeComSocket } from './connection';
export {
  generateReqId,
  threadFromBody,
  threadKey,
  truncateUtf8,
  WeComLongConnection,
} from './connection';
export {
  decryptWeComMedia,
  signForwardedFrame,
  verifyForwardedFrame,
  WECOM_SIGNATURE_HEADER,
  WECOM_TIMESTAMP_HEADER,
} from './crypto';
export { WeComFormatConverter } from './format-converter';
export type { DownloadedWeComMedia, WeComMediaKind, WeComMediaRef } from './media';
export { collectWeComMedia, downloadWeComMedia } from './media';
export {
  getWeComConnection,
  registerWeComConnection,
  requireWeComConnection,
  unregisterWeComConnection,
  WeComConnectionUnavailableError,
} from './registry';
export type {
  WeComAdapterConfig,
  WeComChatType,
  WeComForwardedFrame,
  WeComFrame,
  WeComMedia,
  WeComMessageBody,
  WeComRawMessage,
  WeComThreadId,
} from './types';
export { WECOM_CMD, WECOM_DEFAULT_WS_URL, WECOM_MAX_CONTENT_BYTES } from './types';
