export {
  createMatrixAdapter,
  extractMediaMetadata,
  MatrixAdapter,
} from './adapter';
export { MatrixApiClient, parseMxc } from './api';
export { htmlToPlainText, markdownToMatrixHtml, MatrixFormatConverter } from './format-converter';
export { MatrixSyncConnection } from './sync';
export type {
  MatrixAdapterConfig,
  MatrixErrorBody,
  MatrixLoginResponse,
  MatrixMessageContent,
  MatrixRoomEvent,
  MatrixSendEventResponse,
  MatrixSyncResponse,
  MatrixThreadId,
  MatrixWebhookPayload,
  MatrixWhoamiResponse,
} from './types';
