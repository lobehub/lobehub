import debug from 'debug';

const log = debug('bot-platform:feishu:gateway');

export interface FeishuWSOptions {
  appId: string;
  appSecret: string;
  /** 'feishu' or 'lark' — determines the API domain */
  domain: 'feishu' | 'lark';
  /**
   * Verification token configured by the user. When provided, it is injected
   * into the forwarded webhook payload's `header.token` so the downstream
   * webhook handler's token check passes.
   */
  verificationToken?: string;
  /** URL to forward events to (POST) */
  webhookUrl: string;
}

/**
 * Wraps the official Lark SDK's WSClient to manage a persistent WebSocket
 * connection for Feishu/Lark bots.
 *
 * Events received via WebSocket are forwarded to the webhook URL as HTTP POSTs,
 * preserving compatibility with the existing handleWebhook() pipeline.
 */
export class FeishuWSConnection {
  private readonly options: FeishuWSOptions;
  private wsClient: any = null;

  constructor(options: FeishuWSOptions) {
    this.options = options;
  }

  /**
   * Start the WebSocket connection using the Lark SDK's WSClient.
   * The SDK handles connect, ping, and reconnect internally.
   */
  async start(): Promise<void> {
    const lark = await import('@larksuiteoapi/node-sdk');

    const eventDispatcher = new lark.EventDispatcher({});

    // Register handler for incoming messages
    eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        log('Received im.message.receive_v1 event');
        await this.forwardEvent('im.message.receive_v1', data);
      },
    });

    const domain = this.options.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

    this.wsClient = new lark.WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      domain,
      loggerLevel: lark.LoggerLevel.info,
    });

    await this.wsClient.start({ eventDispatcher });
    log('WSClient started (domain=%s, appId=%s)', this.options.domain, this.options.appId);
  }

  /**
   * Close the WebSocket connection.
   */
  close(): void {
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
      log('WSClient closed');
    }
  }

  /**
   * Forward an event to the webhook URL.
   * The webhook handler expects the Lark event payload wrapped in the standard format.
   *
   * Note: events received via WebSocket are pre-authenticated by the SDK, but the
   * downstream webhook handler still validates `header.token` against the user's
   * configured `verificationToken`. We inject the configured token into the payload
   * so the check passes.
   */
  private async forwardEvent(eventType: string, data: any): Promise<void> {
    // Construct a webhook-compatible payload matching what handleWebhook() expects
    const header: Record<string, string> = {
      event_type: eventType,
    };
    if (this.options.verificationToken) {
      header.token = this.options.verificationToken;
    }

    const webhookPayload = {
      event: data,
      header,
      schema: '2.0',
    };

    try {
      await fetch(this.options.webhookUrl, {
        body: JSON.stringify(webhookPayload),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      log('Failed to forward event %s to webhook: %O', eventType, err);
    }
  }
}
