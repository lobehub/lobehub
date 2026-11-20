import type { RealtimeAsrSessionResponse } from './contract';
import {
  parseRealtimeAsrServerEvent,
  REALTIME_ASR_PROTOCOL_VERSION,
  RealtimeDictationError,
} from './contract';

export interface RealtimeAsrWebSocket {
  addEventListener: ((type: 'close' | 'error' | 'open', listener: () => void) => void) &
    ((type: 'message', listener: (event: MessageEvent) => void) => void);
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  removeEventListener: ((type: 'close' | 'error' | 'open', listener: () => void) => void) &
    ((type: 'message', listener: (event: MessageEvent) => void) => void);
  send: (data: ArrayBuffer | string) => void;
}

export interface DictationConnection {
  deferred: boolean;
  session: RealtimeAsrSessionResponse;
  socket: RealtimeAsrWebSocket;
}

export interface ConnectDictationOptions {
  createSession: (signal: AbortSignal) => Promise<RealtimeAsrSessionResponse>;
  createWebSocket: (url: string) => RealtimeAsrWebSocket;
  onAdmission?: (stage: 'admission' | 'admission_refresh') => void;
  signal: AbortSignal;
  wallClockNow?: () => number;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const ADMISSION_EXPIRY_SAFETY_MS = 1000;

export const closeDictationSocket = (socket: RealtimeAsrWebSocket) => {
  if (socket.readyState === SOCKET_CONNECTING || socket.readyState === SOCKET_OPEN) {
    socket.close(1000, 'dictation_finished');
  }
};

const admit = async ({
  createSession,
  onAdmission,
  signal,
  wallClockNow = Date.now,
}: ConnectDictationOptions) => {
  const isAdmissionExpiring = (session: RealtimeAsrSessionResponse) => {
    const expiresAt = Date.parse(session.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt - wallClockNow() <= ADMISSION_EXPIRY_SAFETY_MS;
  };
  const session = await createSession(signal);
  onAdmission?.('admission');
  if (!isAdmissionExpiring(session)) return session;

  const refreshed = await createSession(signal);
  onAdmission?.('admission_refresh');
  if (isAdmissionExpiring(refreshed)) throw new RealtimeDictationError('SESSION_EXPIRED', true);
  return refreshed;
};

// A Gateway that predates deferred start ignores the request and answers with
// session.ready; callers use `deferred` to fall back to the legacy flow.
export const connectDictationSession = async (
  options: ConnectDictationOptions,
): Promise<DictationConnection> => {
  const session = await admit(options);
  const { signal } = options;
  if (signal.aborted) throw signal.reason ?? new Error('dictation_connect_aborted');

  const socket = options.createWebSocket(session.websocketUrl);
  socket.binaryType = 'arraybuffer';

  return new Promise<DictationConnection>((resolve, reject) => {
    let settled = false;
    const finish = (result: DictationConnection | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('error', handleClosed);
      socket.removeEventListener('close', handleClosed);
      signal.removeEventListener('abort', handleAbort);
      if ('error' in result) {
        closeDictationSocket(socket);
        reject(result.error);
      } else {
        resolve(result);
      }
    };
    const handleOpen = () => {
      socket.send(
        JSON.stringify({
          protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
          start: 'deferred',
          token: session.token,
          type: 'session.auth',
        }),
      );
    };
    const handleMessage = (message: MessageEvent) => {
      let event;
      try {
        event = parseRealtimeAsrServerEvent(message.data);
      } catch (error) {
        finish({ error });
        return;
      }
      if (event.sessionId !== session.sessionId) {
        finish({ error: new RealtimeDictationError('PROTOCOL_ERROR', false) });
      } else if (event.type === 'session.accepted') {
        finish({ deferred: true, session, socket });
      } else if (event.type === 'session.ready') {
        finish({ deferred: false, session, socket });
      } else if (event.type === 'session.error') {
        finish({ error: new RealtimeDictationError(event.code, event.retryable) });
      } else {
        finish({ error: new RealtimeDictationError('PROTOCOL_ERROR', false) });
      }
    };
    const handleClosed = () => {
      finish({ error: new RealtimeDictationError('NETWORK_DISCONNECTED', true) });
    };
    const handleAbort = () => {
      finish({ error: signal.reason ?? new Error('dictation_connect_aborted') });
    };
    const timer = setTimeout(
      () => finish({ error: new RealtimeDictationError('PROVIDER_TIMEOUT', true) }),
      session.limits.authTimeoutMs + session.limits.providerConnectTimeoutMs,
    );

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('error', handleClosed);
    socket.addEventListener('close', handleClosed);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
};

// A connection that resolved after its run failed has no owner left to close it.
export const closeUnadoptedSocket = (
  connection: Promise<DictationConnection>,
  isAdopted: (socket: RealtimeAsrWebSocket) => boolean,
) => {
  void connection.then(
    ({ socket }) => {
      if (!isAdopted(socket)) closeDictationSocket(socket);
    },
    () => undefined,
  );
};
