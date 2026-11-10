import type { RealtimeAsrWebSocket } from '@/features/ChatInput/Dictation/client';
import type {
  RealtimeAsrServerEvent,
  RealtimeAsrSessionResponse,
  RealtimeDictationErrorCode,
} from '@/features/ChatInput/Dictation/contract';
import {
  parseRealtimeAsrServerEvent,
  REALTIME_ASR_LIMITS,
  REALTIME_ASR_PROTOCOL_VERSION,
  RealtimeDictationError,
} from '@/features/ChatInput/Dictation/contract';
import { BoundedWebSocketFrameQueue } from '@/features/ChatInput/Dictation/frameQueue';

import type { FrameLedger } from './frameLedger';
import type {
  LiveErrorCode,
  LiveSegment,
  LiveTranscriber,
  LiveTranscriberEvents,
  LiveTranscriberStatus,
} from './types';
import { FRAME_MS, frameToMs, retryDelay } from './types';

/**
 * A gateway session accepts at most `maxFrames` (60 s). Rotate to a fresh
 * session at the first pause after 45 s, and unconditionally at 57 s so the
 * old session can still end cleanly inside its limit.
 */
export const ROTATE_AFTER_FRAMES = 45_000 / FRAME_MS;
export const FORCE_ROTATE_FRAMES = 57_000 / FRAME_MS;
/** One session streaming the live edge plus one finishing or replaying. */
const MAX_CONCURRENT_SESSIONS = 2;
const SOCKET_OPEN = 1;
const DRAIN_INTERVAL_MS = 40;

export interface GatewayTranscriberDependencies extends LiveTranscriberEvents {
  createSession: (signal: AbortSignal) => Promise<RealtimeAsrSessionResponse>;
  createWebSocket: (url: string) => RealtimeAsrWebSocket;
  ledger: FrameLedger;
  onOnline?: (listener: () => void) => () => void;
}

/**
 * A contiguous range of frames transcribed by exactly one successful session.
 * `to` stays open on the span at the live edge until it rotates.
 */
interface Span {
  finals: { atFrame: number; segmentId: string; text: string }[];
  from: number;
  partial: string;
  session?: Session;
  status: 'active' | 'done' | 'pending';
  to?: number;
}

interface Session {
  abort: AbortController;
  finalTimer?: ReturnType<typeof setTimeout>;
  lastSequence: number;
  queue?: BoundedWebSocketFrameQueue;
  /** Next frame to send. */
  sent: number;
  socket?: RealtimeAsrWebSocket;
  span: Span;
  state: 'admitting' | 'connecting' | 'ending' | 'streaming';
  timeoutMs: number;
}

const toLiveErrorCode = (code: RealtimeDictationErrorCode): LiveErrorCode => {
  switch (code) {
    case 'PROVIDER_BILLING_BLOCKED': {
      return 'quota_exceeded';
    }
    case 'PROVIDER_NOT_CONFIGURED':
    case 'PROVIDER_REGION_UNAVAILABLE': {
      return 'provider_not_configured';
    }
    case 'AUTH_FAILED': {
      return 'auth';
    }
    case 'NETWORK_DISCONNECTED': {
      return 'network';
    }
    default: {
      return 'provider_unavailable';
    }
  }
};

const BLOCKING_CODES = new Set<LiveErrorCode>([
  'auth',
  'provider_not_configured',
  'quota_exceeded',
]);

/**
 * Meeting-length live draft over the 60-second realtime ASR gateway.
 *
 * The recording is split into spans, each streamed by one gateway session.
 * The live span rotates to a new session at a pause after 45 s (forced at
 * 57 s); every frame belongs to exactly one span, so nothing is sent twice
 * and nothing falls between sessions — frames that arrive while the next
 * session connects wait in the ledger.
 *
 * A span's text is committed only after its session completes. If the socket
 * drops, the gateway errors or the final never arrives, the span's partial
 * text is discarded and the span is replayed from the ledger by a new
 * session. That replay is what makes reconnects lossless (no frame lost) and
 * duplicate-free (the failed attempt's text never reaches the transcript).
 * Spans commit strictly in recording order and receive increasing `seq`s.
 */
export class GatewayTranscriber implements LiveTranscriber {
  readonly #deps: GatewayTranscriberDependencies;
  readonly #spans: Span[] = [];
  #attempt = 0;
  #blocked?: LiveErrorCode;
  #disposed = false;
  #drainTimer?: ReturnType<typeof setTimeout>;
  #drainWaiters = new Set<() => void>();
  #errorCode?: LiveErrorCode;
  #nextSeq = 0;
  #offOnline?: () => void;
  #retryAt?: number;
  #retryTimer?: ReturnType<typeof setTimeout>;
  #started = false;

  constructor(
    deps: GatewayTranscriberDependencies,
    options: { startFrame?: number; startSeq?: number } = {},
  ) {
    this.#deps = deps;
    this.#nextSeq = options.startSeq ?? 0;
    this.#spans.push(this.#newSpan(options.startFrame ?? 0));
  }

  /** First frame whose text is not committed yet; a replacement transcriber resumes here. */
  get resumePoint() {
    return {
      startFrame: this.#spans[0]?.from ?? this.#deps.ledger.length,
      startSeq: this.#nextSeq,
    };
  }

  readonly start = () => {
    if (this.#started) return;
    this.#started = true;
    this.#offOnline = this.#deps.onOnline?.(() => {
      if (this.#errorCode === 'network') this.retry();
    });
    this.#pump();
  };

  readonly notifyFrame = () => {
    if (this.#started) this.#pump();
  };

  readonly pause = () => {
    // Close the live span where the recording stopped; its session ends now
    // instead of hitting the gateway's audio-idle timeout.
    const live = this.#liveSpan();
    if (live.from < this.#deps.ledger.length) this.#closeLiveSpan(this.#deps.ledger.length);
    this.#pump();
  };

  readonly retry = () => {
    if (this.#disposed) return;
    this.#blocked = undefined;
    this.#attempt = 0;
    this.#clearRetry();
    this.#pump();
  };

  readonly drain = async (timeoutMs: number) => {
    this.pause();
    if (this.#isDrained()) return true;

    return new Promise<boolean>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#drainWaiters.delete(done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#drainWaiters.delete(done);
        resolve(false);
      }, timeoutMs);
      this.#drainWaiters.add(done);
    });
  };

  readonly dispose = () => {
    this.#disposed = true;
    this.#clearRetry();
    if (this.#drainTimer) clearTimeout(this.#drainTimer);
    this.#offOnline?.();
    for (const span of this.#spans) if (span.session) this.#closeSession(span.session);
    for (const waiter of this.#drainWaiters) waiter();
  };

  // ── Scheduling ──

  #newSpan(from: number): Span {
    return { finals: [], from, partial: '', status: 'pending' };
  }

  #liveSpan() {
    return this.#spans.at(-1)!;
  }

  #closeLiveSpan(at: number) {
    const live = this.#liveSpan();
    live.to = at;
    this.#spans.push(this.#newSpan(at));
  }

  /** End `span` at `at`; the rest becomes the next span (the live one, if `span` was live). */
  #splitSpan(span: Span, at: number) {
    if (span.to === undefined) {
      this.#closeLiveSpan(at);
      return;
    }
    const rest: Span = { ...this.#newSpan(at), to: span.to };
    span.to = at;
    this.#spans.splice(this.#spans.indexOf(span) + 1, 0, rest);
  }

  #activeCount() {
    return this.#spans.filter((span) => span.status === 'active').length;
  }

  #pump = () => {
    if (this.#disposed || !this.#started) return;
    if (this.#drainTimer) {
      clearTimeout(this.#drainTimer);
      this.#drainTimer = undefined;
    }

    const { ledger } = this.#deps;
    let backlog = false;

    for (const span of this.#spans) {
      const session = span.session;
      if (session?.state === 'streaming') backlog = this.#stream(session) || backlog;
    }

    if (!this.#blocked && !this.#retryTimer) {
      for (const span of this.#spans) {
        if (this.#activeCount() >= MAX_CONCURRENT_SESSIONS) break;
        const end = span.to ?? ledger.length;
        // Never open a session without audio to send: it would idle out.
        if (span.status === 'pending' && end > span.from) this.#openSession(span);
      }
    }

    this.#emitStatus();
    if (backlog) this.#drainTimer = setTimeout(this.#pump, DRAIN_INTERVAL_MS);
  };

  /** Send what the session may send; returns whether frames are still waiting on the socket. */
  #stream(session: Session): boolean {
    const { span } = session;
    const { ledger } = this.#deps;

    while (session.sent < (span.to ?? ledger.length)) {
      // Any span — live, closed by a pause, or a backlog caught up after an
      // outage — is cut so no session ever exceeds the gateway's limit.
      const sentFrames = session.sent - span.from;
      const pauseHere = session.sent > span.from && ledger.isSilent(session.sent - 1);
      if (sentFrames >= FORCE_ROTATE_FRAMES || (sentFrames >= ROTATE_AFTER_FRAMES && pauseHere)) {
        this.#splitSpan(span, session.sent);
        break;
      }

      if (!session.queue!.enqueue(ledger.get(session.sent))) return true;
      session.sent += 1;
    }

    if (span.to !== undefined && session.sent >= span.to) {
      void this.#endSession(session);
      return false;
    }
    return false;
  }

  // ── Sessions ──

  async #openSession(span: Span) {
    const session: Session = {
      abort: new AbortController(),
      lastSequence: 0,
      sent: span.from,
      span,
      state: 'admitting',
      timeoutMs: REALTIME_ASR_LIMITS.finalTimeoutMs,
    };
    span.status = 'active';
    span.session = session;
    span.finals = [];
    span.partial = '';

    let admission: RealtimeAsrSessionResponse;
    try {
      admission = await this.#deps.createSession(session.abort.signal);
    } catch (error) {
      if (session.abort.signal.aborted) return;
      let code: RealtimeDictationErrorCode =
        error instanceof RealtimeDictationError ? error.code : 'NETWORK_DISCONNECTED';
      // A deployment without the realtime route answers admission with a
      // redirect or an unexpected body; that is "no gateway here", not an outage.
      if (code === 'SESSION_CREATE_FAILED' || code === 'PROTOCOL_ERROR') {
        code = 'PROVIDER_NOT_CONFIGURED';
      }
      this.#failSession(session, code);
      return;
    }
    if (this.#disposed || span.session !== session) return;

    session.state = 'connecting';
    session.timeoutMs = admission.limits.finalTimeoutMs;
    const socket = this.#deps.createWebSocket(admission.websocketUrl);
    socket.binaryType = 'arraybuffer';
    session.socket = socket;

    const connectTimer = setTimeout(
      () => this.#failSession(session, 'PROVIDER_TIMEOUT'),
      admission.limits.authTimeoutMs + admission.limits.providerConnectTimeoutMs,
    );
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
          token: admission.token,
          type: 'session.auth',
        }),
      );
    });
    socket.addEventListener('message', (message: MessageEvent) => {
      let event: RealtimeAsrServerEvent;
      try {
        event = parseRealtimeAsrServerEvent(message.data);
      } catch {
        this.#failSession(session, 'PROTOCOL_ERROR');
        return;
      }
      if (event.type === 'session.ready') clearTimeout(connectTimer);
      this.#handleEvent(session, event, admission);
    });
    const onDrop = () => {
      clearTimeout(connectTimer);
      this.#failSession(session, 'NETWORK_DISCONNECTED');
    };
    socket.addEventListener('error', onDrop);
    socket.addEventListener('close', onDrop);
  }

  #handleEvent(
    session: Session,
    event: RealtimeAsrServerEvent,
    admission: RealtimeAsrSessionResponse,
  ) {
    const { span } = session;
    if (span.session !== session || event.sessionId !== admission.sessionId) return;
    if (event.sequence <= session.lastSequence) return;
    session.lastSequence = event.sequence;

    switch (event.type) {
      case 'session.ready': {
        if (session.state !== 'connecting') return;
        session.state = 'streaming';
        session.queue = new BoundedWebSocketFrameQueue(session.socket!, {
          maxFrames: admission.limits.maxBufferedFrames,
        });
        this.#pump();
        return;
      }
      case 'transcript.partial': {
        span.partial = event.text;
        this.#emitTail();
        return;
      }
      case 'transcript.final': {
        // A final repeated by the gateway must not repeat in the transcript.
        if (span.finals.some((final) => final.segmentId === event.segmentId)) return;
        span.finals.push({
          atFrame: Math.min(session.sent, span.to ?? session.sent),
          segmentId: event.segmentId,
          text: event.text,
        });
        span.partial = '';
        this.#emitTail();
        return;
      }
      case 'session.completed': {
        if (session.state !== 'ending') {
          this.#failSession(session, 'PROTOCOL_ERROR');
          return;
        }
        this.#closeSession(session);
        span.session = undefined;
        span.status = 'done';
        span.partial = '';
        this.#attempt = 0;
        this.#errorCode = undefined;
        this.#commit();
        this.#pump();
        return;
      }
      case 'session.cancelled': {
        this.#failSession(session, 'PROVIDER_DISCONNECTED');
        return;
      }
      case 'session.error': {
        this.#failSession(session, event.code);
        return;
      }
    }
  }

  async #endSession(session: Session) {
    if (session.state !== 'streaming') return;
    session.state = 'ending';
    try {
      await session.queue!.waitForEmpty(1000);
      if (session.socket?.readyState !== SOCKET_OPEN) throw new Error('socket_closed');
      session.socket.send(JSON.stringify({ type: 'session.end' }));
    } catch {
      this.#failSession(session, 'NETWORK_DISCONNECTED');
      return;
    }
    session.finalTimer = setTimeout(
      () => this.#failSession(session, 'FINAL_TIMEOUT'),
      session.timeoutMs,
    );
  }

  /** Drop the session's partial text and put its span back in line for a replay. */
  #failSession(session: Session, code: RealtimeDictationErrorCode) {
    const { span } = session;
    if (span.session !== session || this.#disposed) return;

    this.#closeSession(session);
    span.session = undefined;
    span.status = 'pending';
    span.finals = [];
    span.partial = '';
    // A live span that failed keeps its open end; frames already sent are replayed.

    const liveCode = toLiveErrorCode(code);
    this.#errorCode = liveCode;
    if (BLOCKING_CODES.has(liveCode)) {
      this.#blocked = liveCode;
    } else if (!this.#retryTimer) {
      const delay = retryDelay(this.#attempt++);
      this.#retryAt = Date.now() + delay;
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = undefined;
        this.#retryAt = undefined;
        this.#pump();
      }, delay);
    }
    this.#emitTail();
    this.#pump();
  }

  #closeSession(session: Session) {
    session.abort.abort();
    if (session.finalTimer) clearTimeout(session.finalTimer);
    session.queue?.dispose();
    const socket = session.socket;
    session.socket = undefined;
    if (socket && socket.readyState <= SOCKET_OPEN) {
      try {
        socket.close(1000, 'meeting_session_rotated');
      } catch {
        // Already closing.
      }
    }
  }

  // ── Output ──

  #commit() {
    const segments: LiveSegment[] = [];
    while (this.#spans.length > 1 && this.#spans[0].status === 'done') {
      const span = this.#spans.shift()!;
      let startFrame = span.from;
      for (const final of span.finals) {
        const text = final.text.trim();
        const endFrame = Math.max(startFrame, final.atFrame);
        if (text) {
          segments.push({
            endMs: frameToMs(endFrame),
            seq: this.#nextSeq++,
            startMs: frameToMs(startFrame),
            text,
          });
        }
        startFrame = endFrame;
      }
    }

    if (segments.length > 0) this.#deps.onSegments(segments);
    this.#emitTail();
    if (this.#isDrained()) for (const waiter of this.#drainWaiters) waiter();
  }

  #isDrained() {
    const live = this.#liveSpan();
    return (
      this.#spans.length === 1 && live.status === 'pending' && live.from >= this.#deps.ledger.length
    );
  }

  #emitTail() {
    const text = this.#spans
      .map((span) => span.finals.map((final) => final.text).join('') + span.partial)
      .join('');
    this.#deps.onTail?.(text);
  }

  #clearRetry() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#retryAt = undefined;
  }

  #emitStatus() {
    const pendingFrom = this.#spans[0]?.from ?? this.#deps.ledger.length;
    const status: LiveTranscriberStatus = {
      pendingMs: frameToMs(Math.max(0, this.#deps.ledger.length - pendingFrom)),
      state: this.#blocked ? 'blocked' : this.#errorCode ? 'reconnecting' : 'live',
    };
    if (this.#errorCode) status.errorCode = this.#errorCode;
    if (this.#retryAt) status.retryInMs = Math.max(0, this.#retryAt - Date.now());
    this.#deps.onStatus(status);
  }
}
