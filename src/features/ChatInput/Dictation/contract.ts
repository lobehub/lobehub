export const REALTIME_ASR_PROTOCOL_VERSION = 1 as const;

export const REALTIME_ASR_AUDIO = {
  channels: 1,
  encoding: 'pcm_s16le',
  frameBytes: 6400,
  frameDurationMs: 200,
  sampleRate: 16_000,
} as const;

export const REALTIME_ASR_LIMITS = {
  audioIdleTimeoutMs: 5000,
  authTimeoutMs: 5000,
  finalTimeoutMs: 5000,
  maxBufferedFrames: 5,
  maxFrames: 300,
  maxSessionMs: 60_000,
  providerConnectTimeoutMs: 5000,
  tokenTtlMs: 30_000,
} as const;

export type RealtimeAsrErrorCode =
  | 'AUDIO_FORMAT_INVALID'
  | 'AUTH_FAILED'
  | 'BACKPRESSURE'
  | 'INTERNAL_ERROR'
  | 'PROTOCOL_ERROR'
  | 'PROVIDER_BILLING_BLOCKED'
  | 'PROVIDER_CAPACITY'
  | 'PROVIDER_DISCONNECTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_REGION_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'SESSION_LIMIT_EXCEEDED'
  | 'WORKER_RESTART';

export type RealtimeDictationClientErrorCode =
  | 'AUDIO_CAPTURE_FAILED'
  | 'FINAL_TIMEOUT'
  | 'MICROPHONE_NOT_SUPPORTED'
  | 'MICROPHONE_PERMISSION_DENIED'
  | 'NETWORK_DISCONNECTED'
  | 'SESSION_CREATE_FAILED';

export type RealtimeDictationErrorCode = RealtimeAsrErrorCode | RealtimeDictationClientErrorCode;

export interface RealtimeAsrSessionResponse {
  audio: typeof REALTIME_ASR_AUDIO;
  expiresAt: string;
  limits: typeof REALTIME_ASR_LIMITS;
  protocolVersion: typeof REALTIME_ASR_PROTOCOL_VERSION;
  sessionId: string;
  token: string;
  websocketUrl: string;
}

interface ServerEventBase {
  sequence: number;
  sessionId: string;
}

export interface RealtimeAsrReadyEvent extends ServerEventBase {
  audio: typeof REALTIME_ASR_AUDIO;
  limits: typeof REALTIME_ASR_LIMITS;
  protocolVersion: typeof REALTIME_ASR_PROTOCOL_VERSION;
  type: 'session.ready';
}

export interface RealtimeAsrTranscriptEvent extends ServerEventBase {
  segmentId: string;
  text: string;
  type: 'transcript.final' | 'transcript.partial';
}

export interface RealtimeAsrCompletedEvent extends ServerEventBase {
  forwardedAudioMs: number;
  type: 'session.completed';
}

export interface RealtimeAsrCancelledEvent extends ServerEventBase {
  forwardedAudioMs: number;
  type: 'session.cancelled';
}

export interface RealtimeAsrErrorEvent extends ServerEventBase {
  code: RealtimeAsrErrorCode;
  retryable: boolean;
  type: 'session.error';
}

export type RealtimeAsrServerEvent =
  | RealtimeAsrCancelledEvent
  | RealtimeAsrCompletedEvent
  | RealtimeAsrErrorEvent
  | RealtimeAsrReadyEvent
  | RealtimeAsrTranscriptEvent;

export type RealtimeDictationStatus =
  'connecting' | 'error' | 'finalizing' | 'idle' | 'listening' | 'requesting_permission';

export interface RealtimeDictationSnapshot {
  errorCode?: RealtimeDictationErrorCode;
  retryable: boolean;
  status: RealtimeDictationStatus;
}

const OPAQUE_ID_PATTERN = /^[\w-]+$/;
const SESSION_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
const JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const MAX_JWT_LENGTH = 4096;
const REALTIME_ASR_WEBSOCKET_PATH = '/api/v1/realtime/ws';
const SESSION_RESPONSE_KEYS = [
  'audio',
  'expiresAt',
  'limits',
  'protocolVersion',
  'sessionId',
  'token',
  'websocketUrl',
];
const ERROR_CODES = new Set<RealtimeAsrErrorCode>([
  'AUDIO_FORMAT_INVALID',
  'AUTH_FAILED',
  'BACKPRESSURE',
  'INTERNAL_ERROR',
  'PROTOCOL_ERROR',
  'PROVIDER_BILLING_BLOCKED',
  'PROVIDER_CAPACITY',
  'PROVIDER_DISCONNECTED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_REGION_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'SESSION_EXPIRED',
  'SESSION_LIMIT_EXCEEDED',
  'WORKER_RESTART',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expectedKeys: string[]) => {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
};

const isOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  OPAQUE_ID_PATTERN.test(value);

const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_ID_PATTERN.test(value);

const isLoopbackHostname = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const isValidWebsocketUrl = (value: unknown, sessionId: string): value is string => {
  if (typeof value !== 'string') return false;

  try {
    const websocketUrl = new URL(value);
    const allowsInsecureDevelopmentSocket =
      process.env.NODE_ENV === 'development' &&
      websocketUrl.protocol === 'ws:' &&
      isLoopbackHostname(websocketUrl.hostname);
    return (
      (websocketUrl.protocol === 'wss:' || allowsInsecureDevelopmentSocket) &&
      !websocketUrl.username &&
      !websocketUrl.password &&
      websocketUrl.pathname === REALTIME_ASR_WEBSOCKET_PATH &&
      !websocketUrl.hash &&
      websocketUrl.search === `?sessionId=${sessionId}`
    );
  } catch {
    return false;
  }
};

const isExactAudio = (value: unknown): value is typeof REALTIME_ASR_AUDIO =>
  isRecord(value) &&
  hasExactKeys(value, Object.keys(REALTIME_ASR_AUDIO)) &&
  value.channels === REALTIME_ASR_AUDIO.channels &&
  value.encoding === REALTIME_ASR_AUDIO.encoding &&
  value.frameBytes === REALTIME_ASR_AUDIO.frameBytes &&
  value.frameDurationMs === REALTIME_ASR_AUDIO.frameDurationMs &&
  value.sampleRate === REALTIME_ASR_AUDIO.sampleRate;

const isExactLimits = (value: unknown): value is typeof REALTIME_ASR_LIMITS =>
  isRecord(value) &&
  hasExactKeys(value, Object.keys(REALTIME_ASR_LIMITS)) &&
  Object.entries(REALTIME_ASR_LIMITS).every(([key, expected]) => value[key] === expected);

const hasValidEnvelope = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & ServerEventBase =>
  isSessionId(value.sessionId) &&
  Number.isSafeInteger(value.sequence) &&
  Number(value.sequence) > 0;

export class RealtimeDictationError extends Error {
  constructor(
    readonly code: RealtimeDictationErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'RealtimeDictationError';
  }
}

export const parseRealtimeAsrSessionResponse = (value: unknown): RealtimeAsrSessionResponse => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SESSION_RESPONSE_KEYS) ||
    value.protocolVersion !== REALTIME_ASR_PROTOCOL_VERSION ||
    !isSessionId(value.sessionId) ||
    typeof value.token !== 'string' ||
    value.token.length > MAX_JWT_LENGTH ||
    !JWT_PATTERN.test(value.token) ||
    !isValidWebsocketUrl(value.websocketUrl, value.sessionId) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !isExactAudio(value.audio) ||
    !isExactLimits(value.limits)
  ) {
    throw new RealtimeDictationError('PROTOCOL_ERROR', false);
  }

  return value as unknown as RealtimeAsrSessionResponse;
};

export const parseRealtimeAsrServerEvent = (raw: unknown): RealtimeAsrServerEvent => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new RealtimeDictationError('PROTOCOL_ERROR', false);
    }
  }

  if (!isRecord(value) || !hasValidEnvelope(value) || typeof value.type !== 'string') {
    throw new RealtimeDictationError('PROTOCOL_ERROR', false);
  }

  switch (value.type) {
    case 'session.ready': {
      if (
        value.protocolVersion !== REALTIME_ASR_PROTOCOL_VERSION ||
        !isExactAudio(value.audio) ||
        !isExactLimits(value.limits)
      ) {
        break;
      }
      return value as unknown as RealtimeAsrReadyEvent;
    }
    case 'transcript.partial':
    case 'transcript.final': {
      if (isOpaqueId(value.segmentId) && typeof value.text === 'string') {
        return value as unknown as RealtimeAsrTranscriptEvent;
      }
      break;
    }
    case 'session.completed':
    case 'session.cancelled': {
      if (
        Number.isSafeInteger(value.forwardedAudioMs) &&
        Number(value.forwardedAudioMs) >= 0 &&
        Number(value.forwardedAudioMs) <= REALTIME_ASR_LIMITS.maxSessionMs
      ) {
        return value as unknown as RealtimeAsrCompletedEvent | RealtimeAsrCancelledEvent;
      }
      break;
    }
    case 'session.error': {
      if (
        typeof value.code === 'string' &&
        ERROR_CODES.has(value.code as RealtimeAsrErrorCode) &&
        typeof value.retryable === 'boolean'
      ) {
        return value as unknown as RealtimeAsrErrorEvent;
      }
      break;
    }
  }

  throw new RealtimeDictationError('PROTOCOL_ERROR', false);
};
