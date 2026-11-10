import type { RealtimeAsrWebSocket } from '@/features/ChatInput/Dictation/client';
import type { RealtimeAsrSessionResponse } from '@/features/ChatInput/Dictation/contract';
import {
  REALTIME_ASR_AUDIO,
  REALTIME_ASR_LIMITS,
  REALTIME_ASR_PROTOCOL_VERSION,
} from '@/features/ChatInput/Dictation/contract';

import { FRAME_BYTES } from '../types';

/**
 * A frame whose first sample carries its ledger index, so the fake gateway can
 * report exactly which frames it heard. `loud` frames are not silent.
 */
export const markedFrame = (index: number, loud = false) => {
  const frame = new ArrayBuffer(FRAME_BYTES);
  const samples = new Int16Array(frame);
  if (loud) samples.fill(8000);
  samples[0] = index % 32_768;
  samples[1] = Math.floor(index / 32_768);
  return frame;
};

export const frameIndex = (frame: ArrayBuffer) => {
  const samples = new Int16Array(frame);
  return samples[0] + samples[1] * 32_768;
};

let sessionCounter = 0;
const nextSessionId = () => {
  sessionCounter += 1;
  return `00000000-0000-4000-8000-${String(sessionCounter).padStart(12, '0')}`;
};

export const admission = (sessionId = nextSessionId()): RealtimeAsrSessionResponse => ({
  audio: REALTIME_ASR_AUDIO,
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
  sessionId,
  token: 'a.b.c',
  websocketUrl: `wss://gateway.test/api/v1/realtime/ws?sessionId=${sessionId}`,
});

type Listener = (event?: any) => void;

/**
 * In-memory stand-in for one gateway WebSocket. It answers auth with
 * `session.ready`, records every audio frame, and on `session.end` emits one
 * final per frame (`f<index> `) followed by `session.completed` — so the
 * committed transcript spells out exactly which frames were transcribed.
 */
export class FakeGatewaySocket implements RealtimeAsrWebSocket {
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = 0;
  readonly frames: number[] = [];
  readonly sessionId: string;
  ended = false;
  closed = false;
  /** Set to make the socket ignore `session.end` (final timeout). */
  silentOnEnd = false;
  #listeners = new Map<string, Set<Listener>>();
  #sequence = 0;

  constructor(url: string) {
    this.sessionId = new URL(url).searchParams.get('sessionId')!;
    queueMicrotask(() => {
      this.readyState = 1;
      this.#fire('open');
    });
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  send(data: ArrayBuffer | string) {
    if (typeof data !== 'string') {
      if (this.ended) throw new Error('frame after session.end');
      this.frames.push(frameIndex(data));
      if (this.frames.length > REALTIME_ASR_LIMITS.maxFrames) throw new Error('session over limit');
      return;
    }

    const message = JSON.parse(data);
    if (message.type === 'session.auth') {
      queueMicrotask(() =>
        this.emit({
          audio: REALTIME_ASR_AUDIO,
          limits: REALTIME_ASR_LIMITS,
          protocolVersion: REALTIME_ASR_PROTOCOL_VERSION,
          type: 'session.ready',
        }),
      );
    } else if (message.type === 'session.end') {
      this.ended = true;
      if (this.silentOnEnd) return;
      queueMicrotask(() => {
        this.frames.forEach((frame, index) =>
          this.emit({ segmentId: `seg-${index}`, text: `f${frame} `, type: 'transcript.final' }),
        );
        this.emit({ forwardedAudioMs: this.frames.length * 200, type: 'session.completed' });
      });
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
  }

  /** Emit a server event with the next sequence number. */
  emit(event: Record<string, unknown>) {
    if (this.closed) return;
    this.#sequence += 1;
    this.#fire('message', {
      data: JSON.stringify({ ...event, sequence: this.#sequence, sessionId: this.sessionId }),
    });
  }

  /** Simulate the network dropping the connection. */
  drop() {
    this.readyState = 3;
    this.#fire('close');
  }

  #fire(type: string, event?: unknown) {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

/** Committed text → the frame indices it covers, in order. */
export const framesInText = (text: string) =>
  text
    .split(' ')
    .filter(Boolean)
    .map((token) => Number(token.slice(1)));
