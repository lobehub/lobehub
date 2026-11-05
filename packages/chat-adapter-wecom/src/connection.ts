import { randomBytes } from 'node:crypto';

import { signForwardedFrame, WECOM_SIGNATURE_HEADER, WECOM_TIMESTAMP_HEADER } from './crypto';
import type {
  WeComFrame,
  WeComMarkdownBody,
  WeComMessageBody,
  WeComStreamBody,
  WeComThreadId,
} from './types';
import { WECOM_CMD, WECOM_DEFAULT_WS_URL, WECOM_MAX_CONTENT_BYTES } from './types';

/** Minimal WebSocket surface (the WHATWG one Node ships), so tests can inject a fake. */
export interface WeComSocket {
  addEventListener: (type: string, listener: (event: any) => void) => void;
  close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  send: (data: string) => void;
}

const SOCKET_OPEN = 1;

export interface WeComConnectionOptions {
  /** Stops the connection when aborted. */
  abortSignal?: AbortSignal;
  /** How long a reply frame waits for its receipt. */
  ackTimeoutMs?: number;
  botId: string;
  /** How long `start()` waits for the subscribe receipt. */
  connectTimeoutMs?: number;
  createSocket?: (url: string) => WeComSocket;
  fetchImpl?: typeof fetch;
  heartbeatIntervalMs?: number;
  log?: (message: string, ...args: unknown[]) => void;
  maxReconnectDelayMs?: number;
  now?: () => number;
  /**
   * WeCom allows ONE live connection per bot: a newer subscribe kicks this one with a
   * `disconnected_event`. Reconnecting would just kick the other side back, so the connection
   * stops and reports it instead.
   */
  onDisplaced?: () => void;
  /** A reconnect was refused (credentials revoked, bot deleted). The connection has stopped. */
  onFatalError?: (error: Error) => void;
  /** How long after a message its req_id still accepts a passive reply (platform: 24h). */
  replyWindowMs?: number;
  secret: string;
  /**
   * A stream must be finished within 10 minutes of its first frame, or WeCom drops it. An open
   * stream is closed a little before that, so the reply goes out as a proactive push instead.
   */
  streamMaxOpenMs?: number;
  /** Where inbound message frames are POSTed (the platform webhook route). */
  webhookUrl: string;
  wsUrl?: string;
}

interface ReplyJob {
  frame: WeComFrame;
  reject: (error: Error) => void;
  resolve: (frame: WeComFrame) => void;
}

interface ReplyContext {
  receivedAt: number;
  reqId: string;
  used: boolean;
}

interface OpenStream {
  content: string;
  reqId: string;
  streamId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface WeComDeliveryResult {
  id: string;
  /** `stream` finished the open stream, `reply` answered on a fresh req_id, `push` was proactive. */
  via: 'push' | 'reply' | 'stream';
}

export const generateReqId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${randomBytes(6).toString('hex')}`;

export const threadKey = (thread: WeComThreadId): string => `${thread.type}:${thread.id}`;

/** The conversation an inbound message belongs to: the sender in a DM, the group in a group. */
export const threadFromBody = (body: WeComMessageBody): WeComThreadId | undefined => {
  if (body.chattype === 'group')
    return body.chatid ? { id: body.chatid, type: 'group' } : undefined;
  return body.from?.userid ? { id: body.from.userid, type: 'single' } : undefined;
};

/** Cut `text` to at most `maxBytes` of UTF-8 without splitting a character. */
export const truncateUtf8 = (text: string, maxBytes = WECOM_MAX_CONTENT_BYTES): string => {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let bytes = 0;
  let out = '';
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
};

/**
 * One WeCom AI-bot long connection.
 *
 * Inbound: subscribes with BotID + Secret, answers heartbeats, and forwards every message frame —
 * signed with the Secret — to `webhookUrl`, so messages enter the same webhook pipeline as every
 * other platform.
 *
 * Outbound: WeCom has no REST send API for AI bots; replies, streams and proactive pushes all
 * travel on this socket. So the connection also owns the reply state: the req_id of each
 * conversation's latest message, and the stream currently open in it.
 */
export class WeComLongConnection {
  readonly botId: string;

  private readonly options: Required<
    Omit<WeComConnectionOptions, 'abortSignal' | 'onDisplaced' | 'onFatalError'>
  > &
    Pick<WeComConnectionOptions, 'abortSignal' | 'onDisplaced' | 'onFatalError'>;

  private authenticated = false;
  private connectPromise: Promise<void> | null = null;
  private displaced = false;
  private everSubscribed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly replyContexts = new Map<string, ReplyContext>();
  private readonly replyQueues = new Map<string, ReplyJob[]>();
  private readonly pendingAcks = new Map<
    string,
    { job: ReplyJob; timer: ReturnType<typeof setTimeout> }
  >();
  private socket: WeComSocket | null = null;
  private stopped = false;
  private readonly streams = new Map<string, OpenStream>();

  constructor(options: WeComConnectionOptions) {
    this.botId = options.botId;
    this.options = {
      ackTimeoutMs: 10_000,
      connectTimeoutMs: 15_000,
      createSocket: (url) => new WebSocket(url) as unknown as WeComSocket,
      fetchImpl: globalThis.fetch.bind(globalThis),
      heartbeatIntervalMs: 30_000,
      log: () => {},
      maxReconnectDelayMs: 30_000,
      now: Date.now,
      replyWindowMs: 24 * 60 * 60 * 1000,
      streamMaxOpenMs: 9 * 60 * 1000,
      wsUrl: WECOM_DEFAULT_WS_URL,
      ...options,
    };
    options.abortSignal?.addEventListener('abort', () => this.stop(), { once: true });
  }

  get isConnected(): boolean {
    return this.authenticated && this.socket?.readyState === SOCKET_OPEN;
  }

  get isDisplaced(): boolean {
    return this.displaced;
  }

  /** Whether this connection authenticated with `secret` (credential checks reuse a live one). */
  usesSecret(secret: string): boolean {
    return this.options.secret === secret;
  }

  /** Connect and subscribe. Resolves once WeCom accepts the BotID + Secret, rejects otherwise. */
  start(): Promise<void> {
    if (this.options.abortSignal?.aborted) return Promise.reject(new Error('aborted'));
    this.stopped = false;
    this.displaced = false;
    return this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.teardownSocket();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const stream of this.streams.values()) clearTimeout(stream.timer);
    this.streams.clear();
    this.replyContexts.clear();
    this.options.log('WeCom bot %s: connection stopped', this.botId);
  }

  // ------------------------------------------------------------------
  // Outbound
  // ------------------------------------------------------------------

  /** Send a passive reply frame on an inbound req_id and wait for its receipt. */
  respond(reqId: string, body: WeComStreamBody): Promise<WeComFrame> {
    return this.enqueue({ body, cmd: WECOM_CMD.RESPOND, headers: { req_id: reqId } });
  }

  /** Proactive push to a user (`single`) or group chat the user has talked to the bot in. */
  push(thread: WeComThreadId, content: string): Promise<WeComFrame> {
    const body: WeComMarkdownBody & { chatid: string } = {
      chatid: thread.id,
      markdown: { content: truncateUtf8(content) },
      msgtype: 'markdown',
    };
    return this.enqueue({
      body,
      cmd: WECOM_CMD.SEND_MSG,
      headers: { req_id: generateReqId(WECOM_CMD.SEND_MSG) },
    });
  }

  /**
   * Show the bot as working: open a stream bubble on the conversation's latest message. No-op when
   * a stream is already open there or no message is waiting for an answer. Returns whether a
   * stream is open afterwards.
   */
  async openStream(thread: WeComThreadId, content = ''): Promise<boolean> {
    const key = threadKey(thread);
    if (this.streams.has(key)) return true;

    const context = this.takeReplyContext(key);
    if (!context) return false;

    const streamId = randomBytes(12).toString('hex');
    const stream: OpenStream = {
      content,
      reqId: context.reqId,
      streamId,
      timer: setTimeout(() => {
        void this.expireStream(key, streamId);
      }, this.options.streamMaxOpenMs),
    };
    this.streams.set(key, stream);

    try {
      await this.respond(context.reqId, {
        msgtype: 'stream',
        stream: { content: truncateUtf8(content), finish: false, id: streamId },
      });
      return true;
    } catch (error) {
      this.options.log('WeCom bot %s: opening stream failed: %O', this.botId, error);
      clearTimeout(stream.timer);
      this.streams.delete(key);
      // The req_id was never answered; leave it for the reply itself.
      context.used = false;
      return false;
    }
  }

  /**
   * Deliver a message to a conversation, preferring the forms that render as the bot's answer:
   * finish the open stream, else answer the latest unanswered message, else push proactively.
   * A failed passive send falls through to the push so the reply is not lost.
   */
  async deliver(thread: WeComThreadId, content: string): Promise<WeComDeliveryResult> {
    const key = threadKey(thread);
    const text = truncateUtf8(content);

    const stream = this.streams.get(key);
    if (stream) {
      clearTimeout(stream.timer);
      this.streams.delete(key);
      try {
        await this.respond(stream.reqId, {
          msgtype: 'stream',
          stream: { content: text, finish: true, id: stream.streamId },
        });
        return { id: stream.streamId, via: 'stream' };
      } catch (error) {
        this.options.log('WeCom bot %s: finishing stream failed: %O', this.botId, error);
      }
    } else {
      const context = this.takeReplyContext(key);
      if (context) {
        const streamId = randomBytes(12).toString('hex');
        try {
          await this.respond(context.reqId, {
            msgtype: 'stream',
            stream: { content: text, finish: true, id: streamId },
          });
          return { id: streamId, via: 'reply' };
        } catch (error) {
          this.options.log('WeCom bot %s: passive reply failed: %O', this.botId, error);
        }
      }
    }

    const ack = await this.push(thread, text);
    return { id: ack.headers.req_id, via: 'push' };
  }

  // ------------------------------------------------------------------
  // Connection lifecycle
  // ------------------------------------------------------------------

  private connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connectPromise = null;
        if (error) reject(error);
        else resolve();
      };

      const timeout = setTimeout(() => {
        settle(new Error('WeCom long connection timed out waiting for subscribe receipt'));
        this.teardownSocket();
      }, this.options.connectTimeoutMs);

      let socket: WeComSocket;
      try {
        socket = this.options.createSocket(this.options.wsUrl);
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.socket = socket;
      this.authenticated = false;
      const subscribeReqId = generateReqId(WECOM_CMD.SUBSCRIBE);

      socket.addEventListener('open', () => {
        this.sendFrame({
          body: { bot_id: this.options.botId, secret: this.options.secret },
          cmd: WECOM_CMD.SUBSCRIBE,
          headers: { req_id: subscribeReqId },
        });
      });

      socket.addEventListener('message', (event: { data: unknown }) => {
        const frame = this.parseFrame(event.data);
        if (!frame) return;

        if (!frame.cmd && frame.headers?.req_id === subscribeReqId) {
          if (frame.errcode === 0) {
            this.authenticated = true;
            this.everSubscribed = true;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.options.log('WeCom bot %s: subscribed', this.botId);
            settle();
          } else {
            const error = new Error(
              `WeCom subscribe rejected: ${frame.errmsg ?? 'unknown'} (errcode ${frame.errcode})`,
            );
            settle(error);
            this.failFatally(error);
          }
          return;
        }
        this.handleFrame(frame);
      });

      socket.addEventListener('close', (event: { code?: number; reason?: string }) => {
        if (this.socket !== socket) return;
        this.options.log(
          'WeCom bot %s: socket closed (code=%s reason=%s)',
          this.botId,
          event?.code,
          event?.reason,
        );
        this.onSocketGone();
        settle(new Error('WeCom long connection closed before subscribing'));
      });

      socket.addEventListener('error', (event: unknown) => {
        this.options.log('WeCom bot %s: socket error: %O', this.botId, event);
      });
    });

    return this.connectPromise;
  }

  private handleFrame(frame: WeComFrame): void {
    if (frame.cmd === WECOM_CMD.MSG_CALLBACK) {
      this.recordInbound(frame as WeComFrame<WeComMessageBody>);
      void this.forward(frame);
      return;
    }

    if (frame.cmd === WECOM_CMD.EVENT_CALLBACK) {
      if (frame.body?.event?.eventtype === 'disconnected_event') {
        this.options.log('WeCom bot %s: displaced by a newer connection', this.botId);
        this.displaced = true;
        this.stop();
        this.options.onDisplaced?.();
      }
      // enter_chat / feedback / template-card events have no agent behaviour yet.
      return;
    }

    if (frame.cmd) return;
    const reqId = frame.headers?.req_id ?? '';

    if (reqId.startsWith(WECOM_CMD.HEARTBEAT)) {
      this.missedHeartbeats = 0;
      return;
    }

    const pending = this.pendingAcks.get(reqId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAcks.delete(reqId);
    if (frame.errcode && frame.errcode !== 0) {
      pending.job.reject(
        new Error(
          `WeCom rejected ${pending.job.frame.cmd}: ${frame.errmsg} (errcode ${frame.errcode})`,
        ),
      );
    } else {
      pending.job.resolve(frame);
    }
    this.advanceQueue(reqId);
  }

  private recordInbound(frame: WeComFrame<WeComMessageBody>): void {
    const body = frame.body;
    const thread = body && threadFromBody(body);
    if (!thread || !frame.headers?.req_id) return;
    this.replyContexts.set(threadKey(thread), {
      receivedAt: this.options.now(),
      reqId: frame.headers.req_id,
      used: false,
    });
  }

  private takeReplyContext(key: string): ReplyContext | undefined {
    const context = this.replyContexts.get(key);
    if (!context || context.used) return undefined;
    if (this.options.now() - context.receivedAt > this.options.replyWindowMs) {
      this.replyContexts.delete(key);
      return undefined;
    }
    context.used = true;
    return context;
  }

  /** Close a stream about to hit WeCom's 10-minute limit; the final reply then goes as a push. */
  private async expireStream(key: string, streamId: string): Promise<void> {
    const stream = this.streams.get(key);
    if (!stream || stream.streamId !== streamId) return;
    this.streams.delete(key);
    try {
      await this.respond(stream.reqId, {
        msgtype: 'stream',
        stream: { content: stream.content || '…', finish: true, id: streamId },
      });
    } catch (error) {
      this.options.log('WeCom bot %s: closing expired stream failed: %O', this.botId, error);
    }
  }

  private async forward(frame: WeComFrame): Promise<void> {
    const body = JSON.stringify(frame);
    const timestamp = String(this.options.now());
    try {
      const res = await this.options.fetchImpl(this.options.webhookUrl, {
        body,
        headers: {
          'Content-Type': 'application/json',
          [WECOM_SIGNATURE_HEADER]: signForwardedFrame(this.options.secret, timestamp, body),
          [WECOM_TIMESTAMP_HEADER]: timestamp,
        },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.options.log('WeCom bot %s: webhook forward returned %d', this.botId, res.status);
      }
    } catch (error) {
      this.options.log('WeCom bot %s: webhook forward failed: %O', this.botId, error);
    }
  }

  // ------------------------------------------------------------------
  // Reply queue — frames sharing a req_id go one at a time, each after the previous receipt,
  // the same ordering the official SDK keeps so stream frames cannot overtake each other.
  // ------------------------------------------------------------------

  private enqueue(frame: WeComFrame): Promise<WeComFrame> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error(`WeCom bot ${this.botId} is not connected`));
        return;
      }
      const reqId = frame.headers.req_id;
      const queue = this.replyQueues.get(reqId) ?? [];
      queue.push({ frame, reject, resolve });
      this.replyQueues.set(reqId, queue);
      if (queue.length === 1) this.sendHead(reqId);
    });
  }

  private sendHead(reqId: string): void {
    const job = this.replyQueues.get(reqId)?.[0];
    if (!job) {
      this.replyQueues.delete(reqId);
      return;
    }
    try {
      this.sendFrame(job.frame);
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error(String(error)));
      this.advanceQueue(reqId);
      return;
    }
    const timer = setTimeout(() => {
      this.pendingAcks.delete(reqId);
      job.reject(new Error(`WeCom ${job.frame.cmd} receipt timed out`));
      this.advanceQueue(reqId);
    }, this.options.ackTimeoutMs);
    this.pendingAcks.set(reqId, { job, timer });
  }

  private advanceQueue(reqId: string): void {
    const queue = this.replyQueues.get(reqId);
    if (!queue) return;
    queue.shift();
    if (queue.length === 0) {
      this.replyQueues.delete(reqId);
      return;
    }
    queueMicrotask(() => this.sendHead(reqId));
  }

  // ------------------------------------------------------------------
  // Plumbing
  // ------------------------------------------------------------------

  private sendFrame(frame: WeComFrame): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      throw new Error(`WeCom bot ${this.botId} socket is not open`);
    }
    this.socket.send(JSON.stringify(frame));
  }

  private parseFrame(data: unknown): WeComFrame | undefined {
    try {
      const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString();
      const frame = JSON.parse(text) as WeComFrame;
      return frame && typeof frame === 'object' && frame.headers ? frame : undefined;
    } catch {
      this.options.log('WeCom bot %s: dropped an unparseable frame', this.botId);
      return undefined;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.missedHeartbeats >= 2) {
        this.options.log('WeCom bot %s: heartbeat lost, reconnecting', this.botId);
        this.teardownSocket();
        this.onSocketGone();
        return;
      }
      this.missedHeartbeats++;
      try {
        this.sendFrame({
          cmd: WECOM_CMD.HEARTBEAT,
          headers: { req_id: generateReqId(WECOM_CMD.HEARTBEAT) },
        });
      } catch {
        // The close handler schedules the reconnect.
      }
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private teardownSocket(): void {
    this.stopHeartbeat();
    this.authenticated = false;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, 'closing');
    } catch {
      // already closed
    }
    for (const [reqId, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.job.reject(new Error(`WeCom bot ${this.botId} connection closed`));
      this.replyQueues.get(reqId)?.shift();
    }
    this.pendingAcks.clear();
    for (const queue of this.replyQueues.values()) {
      for (const job of queue) job.reject(new Error(`WeCom bot ${this.botId} connection closed`));
    }
    this.replyQueues.clear();
  }

  private onSocketGone(): void {
    this.teardownSocket();
    // Only reconnect a connection that subscribed once; a first attempt reports through start().
    if (this.stopped || this.displaced || !this.everSubscribed) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.options.maxReconnectDelayMs);
    this.reconnectAttempts++;
    this.options.log('WeCom bot %s: reconnecting in %dms', this.botId, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.connect().catch((error) => {
        this.options.log('WeCom bot %s: reconnect failed: %O', this.botId, error);
      });
    }, delay);
  }

  private failFatally(error: Error): void {
    const wasRunning = this.everSubscribed;
    this.stop();
    if (wasRunning) this.options.onFatalError?.(error);
  }
}
