export interface BlueBubblesApiConfig {
  /**
   * BlueBubbles API password. The server accepts it as the `password` query
   * parameter for REST calls.
   */
  password: string;
  requestTimeoutMs?: number;
  /**
   * Public base URL of the BlueBubbles server, e.g. `https://mac.example.com`.
   */
  serverUrl: string;
}

export interface ImessageBridgeTransport {
  getChat?: (guid: string, withParts?: string[]) => Promise<BlueBubblesChat>;
  getChatMessages?: (
    chatGuid: string,
    options?: {
      after?: number | string;
      before?: number | string;
      limit?: number;
      offset?: number;
      sort?: 'ASC' | 'DESC';
      withParts?: string[];
    },
  ) => Promise<BlueBubblesQueryResult<BlueBubblesMessage>>;
  sendText?: (
    chatGuid: string,
    message: string,
    options?: BlueBubblesSendOptions,
  ) => Promise<BlueBubblesMessage>;
  startTyping?: (chatGuid: string) => Promise<void>;
}

export interface ImessageAdapterConfig {
  botUserId?: string;
  password?: string;
  requestTimeoutMs?: number;
  serverUrl?: string;
  transport?: ImessageBridgeTransport;
  userName?: string;
  /**
   * Shared secret appended to the LobeHub webhook URL. BlueBubbles webhooks are
   * not signed, so the route-level secret is the lightweight authenticity gate.
   */
  webhookSecret: string;
}

export interface BlueBubblesResponse<T = unknown> {
  data?: T;
  message?: string;
  metadata?: {
    count?: number;
    limit?: number;
    offset?: number;
    total?: number;
    [key: string]: unknown;
  };
  status?: number;
}

export interface BlueBubblesHandle {
  address?: string;
  country?: string;
  guid?: string;
  service?: string;
  uncanonicalizedId?: string;
}

export interface BlueBubblesChat {
  chatIdentifier?: string;
  displayName?: string;
  guid: string;
  lastMessage?: BlueBubblesMessage;
  participants?: BlueBubblesHandle[];
  serviceName?: string;
  style?: number;
}

export interface BlueBubblesAttachment {
  filename?: string;
  guid: string;
  mimeType?: string;
  totalBytes?: number;
  transferName?: string;
}

export interface BlueBubblesMessage {
  attachments?: BlueBubblesAttachment[];
  chats?: BlueBubblesChat[];
  dateCreated?: number | null;
  guid: string;
  handle?: BlueBubblesHandle | null;
  handleId?: number | string | null;
  isFromMe?: boolean;
  otherHandle?: number | string | null;
  subject?: string | null;
  tempGuid?: string;
  text?: string | null;
}

export interface BlueBubblesWebhookEvent {
  data?: BlueBubblesMessage;
  type: string;
}

export interface BlueBubblesWebhook {
  events: string[];
  id: number;
  url: string;
}

export interface BlueBubblesQueryResult<T> {
  data: T[];
  metadata?: BlueBubblesResponse<T[]>['metadata'];
}

export interface BlueBubblesSendOptions {
  method?: 'apple-script' | 'private-api';
  tempGuid?: string;
}

export interface BlueBubblesOutboundAttachment {
  data?: string;
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
}

export interface BlueBubblesDownloadedAttachment {
  buffer: Buffer;
  mimeType?: string;
}

export interface ImessageThreadId {
  chatGuid: string;
}
