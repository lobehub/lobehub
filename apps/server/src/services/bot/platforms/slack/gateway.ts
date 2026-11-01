import { createHmac } from 'node:crypto';

import debug from 'debug';

import { SLACK_API_BASE } from './api';

const log = debug('bot-platform:slack:gateway');

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const SLACK_SIGNATURE_VERSION = 'v0';

export interface SlackSocketModeOptions {
  /** AbortSignal to cancel the connection */
  abortSignal?: AbortSignal;
  /** App-level token (xapp-*) for apps.connections.open */
  appToken: string;
  /** Duration in ms before the connection auto-closes (caller restarts) */
  durationMs?: number;
  /** Signing secret used to synthesize Slack-compatible webhook signatures */
  signingSecret: string;
  /** URL to forward events to (POST) */
  webhookUrl: string;
}

interface SlackSocketEnvelope {
  accepts_response_payload?: boolean;
  envelope_id: string;
  payload: any;
  reason?: string;
  type: string;
}

/**
 * Manages a persistent WebSocket connection to Slack via Socket Mode.
 *
 * Lifecycle: apps.connections.open → WSS connect → hello → receive events → acknowledge → forward.
 * Handles disconnect/refresh messages by reconnecting with a new WSS URL.
 */
export class SlackSocketModeConnection {
  private readonly appToken: string;
  private readonly abortSignal?: AbortSignal;
  private readonly durationMs?: number;
  private readonly signingSecret: string;
  private readonly webhookUrl: string;

  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempts = 0;

  constructor(options: SlackSocketModeOptions) {
    this.appToken = options.appToken;
    this.abortSignal = options.abortSignal;
    this.durationMs = options.durationMs;
    this.signingSecret = options.signingSecret;
    this.webhookUrl = options.webhookUrl;
  }

  /**
   * Start the Socket Mode connection.
   * Resolves once the `hello` message is received.
   */
  async connect(): Promise<void> {
    if (this.abortSignal?.aborted) return;

    const url = await this.getSocketUrl();
    log('Socket Mode URL obtained');

    return this.openConnection(url);
  }

  /**
   * Gracefully close the connection.
   */
  close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close(1000, 'Client shutdown');
      this.ws = null;
    }
  }

  // ---------- Socket URL ----------

  private async getSocketUrl(): Promise<string> {
    const response = await fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`apps.connections.open failed: ${response.status}`);
    }

    const data = (await response.json()) as { ok: boolean; url?: string; error?: string };
    if (!data.ok || !data.url) {
      throw new Error(`apps.connections.open failed: ${data.error || 'no url returned'}`);
    }

    return data.url;
  }

  // ---------- Connection Management ----------

  private openConnection(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.abortSignal?.aborted || this.closed) {
        resolve();
        return;
      }

      const ws = new WebSocket(url);
      this.ws = ws;

      let resolved = false;

      const onAbort = () => {
        this.close();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      this.abortSignal?.addEventListener('abort', onAbort, { once: true });

      ws.addEventListener('open', () => {
        log('WebSocket connected');
        this.reconnectAttempts = 0;
      });

      ws.addEventListener('message', (event) => {
        const data =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);

        let envelope: SlackSocketEnvelope;
        try {
          envelope = JSON.parse(data);
        } catch {
          log('Failed to parse message: %s', data);
          return;
        }

        this.handleEnvelope(envelope, (err?: Error) => {
          if (resolved) return;
          resolved = true;
          if (err) reject(err);
          else resolve();
        });
      });

      ws.addEventListener('close', (event) => {
        log('WebSocket closed: code=%d reason=%s', event.code, event.reason);
        this.abortSignal?.removeEventListener('abort', onAbort);

        if (!resolved) {
          resolved = true;
          resolve();
        }

        if (!this.closed && !this.abortSignal?.aborted) {
          this.attemptReconnect();
        }
      });

      ws.addEventListener('error', (event) => {
        log('WebSocket error: %O', event);
        if (!resolved) {
          resolved = true;
          reject(new Error('WebSocket connection failed'));
        }
      });

      // Auto-close after durationMs
      if (this.durationMs) {
        setTimeout(() => {
          if (!this.closed && !this.abortSignal?.aborted) {
            log('Duration elapsed (%dms), closing', this.durationMs);
            this.close();
          }
        }, this.durationMs);
      }
    });
  }

  // ---------- Envelope Handling ----------

  private handleEnvelope(envelope: SlackSocketEnvelope, onReady: (err?: Error) => void): void {
    switch (envelope.type) {
      case 'hello': {
        log('Hello received');
        onReady();
        break;
      }

      case 'disconnect': {
        log('Disconnect: reason=%s', envelope.reason);
        if (envelope.reason === 'link_disabled') {
          // App disabled Socket Mode — stop reconnecting
          this.close();
        } else {
          // refresh_requested or warning — reconnect
          this.ws?.close(1000, 'Reconnecting');
        }
        break;
      }

      case 'events_api':
      case 'slash_commands':
      case 'interactive': {
        // Acknowledge immediately — Slack retries if not acked
        this.acknowledge(envelope.envelope_id);
        // Forward the event payload to webhook URL
        this.forwardEvent(envelope);
        break;
      }

      default: {
        // Acknowledge unknown types to prevent retries
        if (envelope.envelope_id) {
          this.acknowledge(envelope.envelope_id);
        }
        log('Unhandled envelope type: %s', envelope.type);
      }
    }
  }

  private acknowledge(envelopeId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ envelope_id: envelopeId }));
    }
  }

  // ---------- Event Forwarding ----------

  private forwardEvent(envelope: SlackSocketEnvelope): void {
    const forwardedRequest = this.buildForwardedRequest(envelope);

    fetch(this.webhookUrl, {
      body: forwardedRequest.body,
      headers: forwardedRequest.headers,
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      log('Failed to forward event to webhook: %O', err);
    });
  }

  private buildForwardedRequest(envelope: SlackSocketEnvelope) {
    const body = this.serializePayload(envelope);
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = this.signBody(body, timestamp);

    return {
      body,
      headers: {
        'Content-Type': this.getContentType(envelope.type),
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
    };
  }

  private getContentType(envelopeType: SlackSocketEnvelope['type']) {
    switch (envelopeType) {
      case 'interactive':
      case 'slash_commands': {
        return 'application/x-www-form-urlencoded';
      }
      default: {
        return 'application/json';
      }
    }
  }

  private serializePayload(envelope: SlackSocketEnvelope) {
    switch (envelope.type) {
      case 'interactive': {
        return new URLSearchParams({ payload: JSON.stringify(envelope.payload) }).toString();
      }
      case 'slash_commands': {
        const params = new URLSearchParams();

        for (const [key, value] of Object.entries(envelope.payload)) {
          if (value === undefined || value === null) continue;
          params.append(key, String(value));
        }

        return params.toString();
      }
      default: {
        return JSON.stringify(envelope.payload);
      }
    }
  }

  private signBody(body: string, timestamp: string) {
    const baseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`;
    const digest = createHmac('sha256', this.signingSecret).update(baseString).digest('hex');

    return `${SLACK_SIGNATURE_VERSION}=${digest}`;
  }

  // ---------- Reconnection ----------

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log('Max reconnect attempts reached (%d), giving up', MAX_RECONNECT_ATTEMPTS);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );

    log(
      'Reconnecting in %dms (attempt %d/%d)',
      delay,
      this.reconnectAttempts,
      MAX_RECONNECT_ATTEMPTS,
    );

    setTimeout(async () => {
      if (this.closed || this.abortSignal?.aborted) return;

      try {
        // Get a fresh WSS URL for each reconnect
        const url = await this.getSocketUrl();
        await this.openConnection(url);
      } catch (err) {
        log('Reconnect failed: %O', err);
        this.attemptReconnect();
      }
    }, delay);
  }
}
