import type {
  BlueBubblesChat,
  BlueBubblesDownloadedAttachment,
  BlueBubblesMessage,
  BlueBubblesOutboundAttachment,
  BlueBubblesQueryResult,
  BlueBubblesSendOptions,
} from '@lobechat/chat-adapter-imessage';

import { deviceGateway } from '@/server/services/deviceGateway';

const IMESSAGE_MESSAGE_API_TIMEOUT_MS = 60_000;

interface ImessageDesktopBridgeOptions {
  applicationId: string;
  deviceId: string;
  userId: string;
}

interface DownloadAttachmentResult {
  data: string;
  mimeType?: string;
}

export class ImessageDesktopBridgeApi {
  private readonly applicationId: string;
  private readonly deviceId: string;
  private readonly userId: string;

  constructor(options: ImessageDesktopBridgeOptions) {
    this.applicationId = options.applicationId;
    this.deviceId = options.deviceId;
    this.userId = options.userId;
  }

  ping = async (): Promise<void> => {
    await this.call<Record<string, unknown>>('ping', {});
  };

  getChat = async (
    guid: string,
    withParts: string[] = ['participants'],
  ): Promise<BlueBubblesChat> => this.call<BlueBubblesChat>('getChat', { guid, withParts });

  getChatMessages = async (
    chatGuid: string,
    options: {
      after?: number | string;
      before?: number | string;
      limit?: number;
      offset?: number;
      sort?: 'ASC' | 'DESC';
      withParts?: string[];
    } = {},
  ): Promise<BlueBubblesQueryResult<BlueBubblesMessage>> =>
    this.call<BlueBubblesQueryResult<BlueBubblesMessage>>('getChatMessages', {
      chatGuid,
      options,
    });

  queryMessages = async (
    body: Record<string, unknown>,
  ): Promise<BlueBubblesQueryResult<BlueBubblesMessage>> =>
    this.call<BlueBubblesQueryResult<BlueBubblesMessage>>('queryMessages', { body });

  queryChats = async (
    body: Record<string, unknown>,
  ): Promise<BlueBubblesQueryResult<BlueBubblesChat>> =>
    this.call<BlueBubblesQueryResult<BlueBubblesChat>>('queryChats', { body });

  sendText = async (
    chatGuid: string,
    message: string,
    options: BlueBubblesSendOptions = {},
  ): Promise<BlueBubblesMessage> =>
    this.call<BlueBubblesMessage>('sendText', { chatGuid, message, options });

  sendAttachment = async (
    chatGuid: string,
    attachment: BlueBubblesOutboundAttachment,
    options: BlueBubblesSendOptions = {},
  ): Promise<BlueBubblesMessage> =>
    this.call<BlueBubblesMessage>('sendAttachment', { attachment, chatGuid, options });

  startTyping = async (chatGuid: string): Promise<void> => {
    await this.call<Record<string, unknown>>('startTyping', { chatGuid });
  };

  downloadAttachment = async (guid: string): Promise<BlueBubblesDownloadedAttachment> => {
    const result = await this.call<DownloadAttachmentResult>('downloadAttachment', { guid });
    return {
      buffer: Buffer.from(result.data, 'base64'),
      mimeType: result.mimeType,
    };
  };

  private async call<T>(apiName: string, payload: Record<string, unknown>): Promise<T> {
    const result = await deviceGateway.executeMessageApi(
      { deviceId: this.deviceId, userId: this.userId },
      {
        apiName,
        payload: {
          applicationId: this.applicationId,
          ...payload,
        },
        platform: 'imessage',
      },
      IMESSAGE_MESSAGE_API_TIMEOUT_MS,
    );

    if (!result.success) {
      throw new Error(result.error || result.content || 'iMessage Desktop bridge call failed');
    }

    if (!result.content) return {} as T;
    return JSON.parse(result.content) as T;
  }
}
