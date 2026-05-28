import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  BlueBubblesApiClient,
  type BlueBubblesMessage,
  type BlueBubblesOutboundAttachment,
  type BlueBubblesSendOptions,
  type BlueBubblesWebhookEvent,
} from '@lobechat/chat-adapter-imessage';
import type {
  ImessageBridgeConfig,
  ImessageBridgePublicConfig,
  ImessageBridgeStatus,
} from '@lobechat/electron-client-ipc';
import { getPort } from 'get-port-please';

import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:ImessageBridgeSrv');

const STORE_KEY = 'imessageBridgeConfigs';
const LOCAL_HOST = '127.0.0.1';
const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;

interface RemoteServerProvider {
  getAccessToken: () => Promise<string | null>;
  getServerUrl: () => Promise<string | null>;
}

type StoredImessageBridgeConfig = ImessageBridgeConfig & { blueBubblesPassword: string };

interface ChatMessagesOptions {
  after?: number | string;
  before?: number | string;
  limit?: number;
  offset?: number;
  sort?: 'ASC' | 'DESC';
  withParts?: string[];
}

function toPublicConfig(config: StoredImessageBridgeConfig): ImessageBridgePublicConfig {
  const { blueBubblesPassword, ...rest } = config;
  return {
    ...rest,
    blueBubblesPasswordSet: Boolean(blueBubblesPassword),
  };
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

export default class ImessageBridgeService extends ServiceModule {
  private httpServer: Server | null = null;
  private remoteServerProvider: RemoteServerProvider | null = null;
  private serverPort = 0;

  setRemoteServerProvider(provider: RemoteServerProvider) {
    this.remoteServerProvider = provider;
  }

  getConfigs(): ImessageBridgePublicConfig[] {
    return this.readConfigs().map(toPublicConfig);
  }

  getStatus(): ImessageBridgeStatus {
    return {
      configs: this.getConfigs(),
      running: Boolean(this.httpServer),
      serverUrl: this.httpServer ? this.getLocalServerUrl() : undefined,
    };
  }

  async upsertConfig(config: ImessageBridgeConfig): Promise<ImessageBridgePublicConfig> {
    const configs = this.readConfigs();
    const index = configs.findIndex((item) => item.applicationId === config.applicationId?.trim());
    const normalized = this.normalizeConfig(config, index >= 0 ? configs[index] : undefined);
    if (index >= 0) {
      configs[index] = normalized;
    } else {
      configs.push(normalized);
    }

    this.writeConfigs(configs);

    if (normalized.enabled) {
      await this.ensureServer();
      await this.registerWebhook(normalized);
    } else if (configs.every((item) => !item.enabled)) {
      // Disabling the last enabled config must tear the loopback server down,
      // otherwise getStatus() keeps reporting running:true (mirrors removeConfig).
      await this.stop();
    }

    return toPublicConfig(normalized);
  }

  async removeConfig(applicationId: string): Promise<{ success: boolean }> {
    const id = applicationId.trim();
    this.writeConfigs(this.readConfigs().filter((config) => config.applicationId !== id));
    if (this.readConfigs().every((config) => !config.enabled)) {
      await this.stop();
    }
    return { success: true };
  }

  async start(): Promise<ImessageBridgeStatus> {
    const enabled = this.readConfigs().filter((config) => config.enabled);
    if (enabled.length === 0) return this.getStatus();

    await this.ensureServer();
    await Promise.all(enabled.map((config) => this.registerWebhook(config)));
    return this.getStatus();
  }

  async stop(): Promise<{ success: boolean }> {
    if (!this.httpServer) return { success: true };

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    this.httpServer = null;
    this.serverPort = 0;
    return { success: true };
  }

  async testConfig(config: ImessageBridgeConfig): Promise<{ success: boolean }> {
    const existing = this.readConfigs().find(
      (item) => item.applicationId === config.applicationId?.trim(),
    );
    await this.createApiClient(this.normalizeConfig(config, existing)).ping();
    return { success: true };
  }

  async handleGatewayMessageApi(apiName: string, args: Record<string, unknown>): Promise<unknown> {
    const applicationId = assertString(args.applicationId, 'applicationId');
    const config = this.findConfig(applicationId);
    const api = this.createApiClient(config);

    switch (apiName) {
      case 'ping': {
        await api.ping();
        return { ok: true };
      }
      case 'sendText': {
        const chatGuid = assertString(args.chatGuid, 'chatGuid');
        const message = assertString(args.message, 'message');
        return api.sendText(chatGuid, message, args.options as BlueBubblesSendOptions | undefined);
      }
      case 'sendAttachment': {
        const chatGuid = assertString(args.chatGuid, 'chatGuid');
        return api.sendAttachment(
          chatGuid,
          args.attachment as BlueBubblesOutboundAttachment,
          args.options as BlueBubblesSendOptions | undefined,
        );
      }
      case 'startTyping': {
        const chatGuid = assertString(args.chatGuid, 'chatGuid');
        await api.startTyping(chatGuid);
        return { ok: true };
      }
      case 'downloadAttachment': {
        const guid = assertString(args.guid, 'guid');
        const attachment = await api.downloadAttachment(guid);
        return {
          data: attachment.buffer.toString('base64'),
          mimeType: attachment.mimeType,
        };
      }
      case 'getChat': {
        const guid = assertString(args.guid, 'guid');
        return api.getChat(guid, args.withParts as string[] | undefined);
      }
      case 'getChatMessages': {
        const chatGuid = assertString(args.chatGuid, 'chatGuid');
        return api.getChatMessages(
          chatGuid,
          (args.options as ChatMessagesOptions | undefined) ?? {},
        );
      }
      case 'queryMessages': {
        return api.queryMessages((args.body as Record<string, unknown>) ?? {});
      }
      case 'queryChats': {
        return api.queryChats((args.body as Record<string, unknown>) ?? {});
      }
      default: {
        throw new Error(`Unsupported iMessage bridge action: ${apiName}`);
      }
    }
  }

  private readConfigs(): StoredImessageBridgeConfig[] {
    return (this.app.storeManager.get(STORE_KEY, []) as StoredImessageBridgeConfig[]) ?? [];
  }

  private writeConfigs(configs: StoredImessageBridgeConfig[]) {
    this.app.storeManager.set(STORE_KEY, configs);
  }

  private normalizeConfig(
    config: ImessageBridgeConfig,
    existing?: StoredImessageBridgeConfig,
  ): StoredImessageBridgeConfig {
    const blueBubblesPassword =
      config.blueBubblesPassword?.trim() || existing?.blueBubblesPassword?.trim();
    if (!blueBubblesPassword) throw new Error('blueBubblesPassword is required');

    return {
      applicationId: assertString(config.applicationId, 'applicationId'),
      blueBubblesPassword,
      blueBubblesServerUrl: assertString(config.blueBubblesServerUrl, 'blueBubblesServerUrl'),
      enabled: config.enabled,
      webhookSecret: assertString(config.webhookSecret, 'webhookSecret'),
    };
  }

  private findConfig(applicationId: string): StoredImessageBridgeConfig {
    const config = this.readConfigs().find((item) => item.applicationId === applicationId);
    if (!config) throw new Error(`iMessage bridge config not found: ${applicationId}`);
    if (!config.enabled) throw new Error(`iMessage bridge config is disabled: ${applicationId}`);
    return config;
  }

  private createApiClient(config: StoredImessageBridgeConfig): BlueBubblesApiClient {
    return new BlueBubblesApiClient({
      password: config.blueBubblesPassword,
      serverUrl: config.blueBubblesServerUrl,
    });
  }

  private async ensureServer(): Promise<void> {
    if (this.httpServer) return;

    this.serverPort = await getPort({
      host: LOCAL_HOST,
      port: 33_270,
      ports: [33_271, 33_272, 33_273, 33_274, 33_275],
    });

    await new Promise<void>((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          await this.handleHttpRequest(req, res);
        } catch (error) {
          logger.error('Unhandled iMessage bridge request error:', error);
          writeText(res, 500, 'Internal Server Error');
        }
      });

      server.listen(this.serverPort, LOCAL_HOST, () => {
        this.httpServer = server;
        logger.info(`iMessage local bridge started on ${this.getLocalServerUrl()}`);
        resolve();
      });
      server.on('error', reject);
    });
  }

  private async registerWebhook(config: StoredImessageBridgeConfig): Promise<void> {
    const webhookUrl = this.getLocalWebhookUrl(config);
    const api = this.createApiClient(config);
    const existing = await api.listWebhooks();
    if (existing.some((webhook) => webhook.url === webhookUrl)) {
      return;
    }
    await api.registerWebhook(webhookUrl, ['new-message']);
    logger.info('Registered BlueBubbles local webhook for iMessage appId=%s', config.applicationId);
  }

  private getLocalServerUrl(): string {
    return `http://${LOCAL_HOST}:${this.serverPort}`;
  }

  private getLocalWebhookUrl(config: ImessageBridgeConfig): string {
    const url = new URL(
      `/webhooks/bluebubbles/${encodeURIComponent(config.applicationId)}`,
      this.getLocalServerUrl(),
    );
    url.searchParams.set('secret', config.webhookSecret);
    return url.toString();
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      writeText(res, 204, '');
      return;
    }

    if (req.method !== 'POST') {
      writeText(res, 405, 'Method Not Allowed');
      return;
    }

    const url = new URL(req.url ?? '/', this.getLocalServerUrl());
    const match = url.pathname.match(/^\/webhooks\/bluebubbles\/([^/]+)$/);
    if (!match) {
      writeText(res, 404, 'Not Found');
      return;
    }

    const applicationId = decodeURIComponent(match[1]);
    const config = this.findConfig(applicationId);
    if (url.searchParams.get('secret') !== config.webhookSecret) {
      writeText(res, 401, 'Invalid secret');
      return;
    }

    const event = (await readJson(req)) as BlueBubblesWebhookEvent;
    const enriched = await this.enrichWebhookEvent(config, event);
    await this.forwardWebhook(config, enriched);
    writeJson(res, 200, { ok: true });
  }

  private async enrichWebhookEvent(
    config: StoredImessageBridgeConfig,
    event: BlueBubblesWebhookEvent,
  ): Promise<BlueBubblesWebhookEvent> {
    const message = event.data;
    if (event.type !== 'new-message' || !message?.guid) return event;

    try {
      const enriched = await this.createApiClient(config).getMessage(message.guid, [
        'chats',
        'attachments',
      ]);
      return { ...event, data: { ...message, ...enriched } as BlueBubblesMessage };
    } catch (error) {
      logger.warn('Failed to enrich iMessage webhook message=%s: %O', message.guid, error);
      return event;
    }
  }

  private async forwardWebhook(
    config: ImessageBridgeConfig,
    event: BlueBubblesWebhookEvent,
  ): Promise<void> {
    if (!this.remoteServerProvider) {
      throw new Error('Remote server provider is not configured');
    }

    const [serverUrl, accessToken] = await Promise.all([
      this.remoteServerProvider.getServerUrl(),
      this.remoteServerProvider.getAccessToken(),
    ]);
    if (!serverUrl) throw new Error('Remote server URL is not configured');

    const target = new URL(
      `/api/agent/webhooks/imessage/${encodeURIComponent(config.applicationId)}`,
      serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`,
    );
    target.searchParams.set('secret', config.webhookSecret);

    const response = await fetch(target, {
      body: JSON.stringify(event),
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch (error) {
        logger.warn('Failed to read LobeHub webhook error response:', error);
      }
      throw new Error(detail || `LobeHub webhook failed with HTTP ${response.status}`);
    }
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_WEBHOOK_BYTES) throw new Error('Webhook payload is too large');
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function writeText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(body);
}
