import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealtimeDictationError } from '@/features/ChatInput/Dictation/contract';

import { FrameLedger } from '../frameLedger';
import {
  FORCE_ROTATE_FRAMES,
  GatewayTranscriber,
  ROTATE_AFTER_FRAMES,
} from '../gatewayTranscriber';
import type { LiveSegment, LiveTranscriberStatus } from '../types';
import { admission, FakeGatewaySocket, framesInText, markedFrame } from './fakeGateway';

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

const setup = (options: { createSession?: () => Promise<any>; loud?: boolean } = {}) => {
  const ledger = new FrameLedger();
  const sockets: FakeGatewaySocket[] = [];
  const segments: LiveSegment[] = [];
  const statuses: LiveTranscriberStatus[] = [];
  const createSession = vi.fn(options.createSession ?? (async () => admission()));
  let onlineListener: (() => void) | undefined;

  const transcriber = new GatewayTranscriber({
    createSession,
    createWebSocket: (url) => {
      const socket = new FakeGatewaySocket(url);
      sockets.push(socket);
      return socket;
    },
    ledger,
    onOnline: (listener) => {
      onlineListener = listener;
      return () => (onlineListener = undefined);
    },
    onSegments: (batch) => segments.push(...batch),
    onStatus: (status) => statuses.push(status),
  });
  transcriber.start();

  /** Record `count` frames in real time (200 ms apart). */
  const record = async (count: number) => {
    for (let i = 0; i < count; i += 1) {
      ledger.append(markedFrame(ledger.length, options.loud));
      transcriber.notifyFrame();
      await vi.advanceTimersByTimeAsync(200);
    }
  };

  /** Drain while letting fake time run, as it would in the browser. */
  const drain = async (ms: number) => {
    const done = transcriber.drain(ms);
    await vi.advanceTimersByTimeAsync(ms);
    return done;
  };

  const committedFrames = () => framesInText(segments.map((s) => s.text).join(' '));

  return {
    committedFrames,
    createSession,
    drain,
    ledger,
    online: () => onlineListener?.(),
    record,
    segments,
    sockets,
    statuses,
    transcriber,
  };
};

describe('GatewayTranscriber', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues a 3-minute meeting across 60 s gateway sessions without losing or repeating a frame', async () => {
    const t = setup({ loud: true });

    // 180 s of continuous speech: no pause, so every rotation is forced.
    await t.record(900);
    expect(await t.drain(10_000)).toBe(true);

    expect(t.committedFrames()).toEqual(range(0, 900));
    expect(t.sockets.length).toBeGreaterThanOrEqual(Math.ceil(900 / FORCE_ROTATE_FRAMES));
    for (const socket of t.sockets) {
      expect(socket.frames.length).toBeLessThanOrEqual(FORCE_ROTATE_FRAMES);
    }
    // Sessions tile the recording: each starts where the previous one stopped.
    const starts = t.sockets.map((socket) => socket.frames[0]);
    const ends = t.sockets.map((socket) => socket.frames.at(-1)! + 1);
    expect(starts.slice(1)).toEqual(ends.slice(0, -1));
    // seq is the order of the draft, timestamps follow the recording.
    expect(t.segments.map((s) => s.seq)).toEqual(range(0, t.segments.length));
    expect(t.segments.at(-1)!.endMs).toBe(900 * 200);
  });

  it('rotates at the first pause after 45 s instead of cutting speech', async () => {
    const t = setup();
    await t.record(ROTATE_AFTER_FRAMES + 10);
    await t.drain(10_000);

    // All frames are silent in this ledger, so the first session ends right at 45 s.
    expect(t.sockets[0].frames).toHaveLength(ROTATE_AFTER_FRAMES);
    expect(t.committedFrames()).toEqual(range(0, ROTATE_AFTER_FRAMES + 10));
  });

  it('replays a span from the ledger after the socket drops, discarding the lost attempt', async () => {
    const t = setup({ loud: true });
    await t.record(100);

    // The gateway already finalized some text, then the connection dropped.
    const first = t.sockets[0];
    first.emit({ segmentId: 'early', text: 'f0 f1 ', type: 'transcript.final' });
    first.drop();
    expect(t.statuses.at(-1)).toMatchObject({ errorCode: 'network', state: 'reconnecting' });

    // Recording continues during the outage, and the retry replays from frame 0.
    await t.record(100);
    await t.drain(20_000);

    expect(t.sockets[1].frames[0]).toBe(0);
    expect(t.committedFrames()).toEqual(range(0, 200));
    // The text the dropped session produced never reached the draft.
    expect(t.segments.filter((s) => s.text === 'f0 f1')).toHaveLength(0);
    expect(t.statuses.at(-1)).toMatchObject({ state: 'live' });
  });

  it('replays an ending span whose final never arrives while the live span keeps streaming', async () => {
    const t = setup({ loud: true });
    await t.record(FORCE_ROTATE_FRAMES - 1);
    // The first session will not answer its session.end.
    t.sockets[0].silentOnEnd = true;
    await t.record(60);

    // finalTimeoutMs elapses → that span is replayed by another session.
    await vi.advanceTimersByTimeAsync(6000);
    await t.drain(20_000);

    const total = FORCE_ROTATE_FRAMES - 1 + 60;
    expect(t.committedFrames()).toEqual(range(0, total));
    const replay = t.sockets.find((socket, index) => index > 0 && socket.frames[0] === 0);
    expect(replay?.frames).toHaveLength(FORCE_ROTATE_FRAMES);
  });

  it('ignores a final the gateway repeats', async () => {
    const t = setup({ loud: true });
    await t.record(5);
    t.sockets[0].emit({ segmentId: 'dup', text: 'hello ', type: 'transcript.final' });
    t.sockets[0].emit({ segmentId: 'dup', text: 'hello ', type: 'transcript.final' });
    await t.drain(10_000);

    expect(t.segments.filter((s) => s.text === 'hello')).toHaveLength(1);
  });

  it('blocks on exhausted quota, keeps recording, and catches up everything after a retry', async () => {
    let quota = false;
    const t = setup({
      createSession: async () => {
        if (!quota) throw new RealtimeDictationError('PROVIDER_BILLING_BLOCKED', false);
        return admission();
      },
      loud: true,
    });

    await t.record(400);
    expect(t.statuses.at(-1)).toMatchObject({ errorCode: 'quota_exceeded', state: 'blocked' });
    expect(t.statuses.at(-1)!.pendingMs).toBe(400 * 200);
    expect(t.segments).toHaveLength(0);

    quota = true;
    t.transcriber.retry();
    await t.drain(30_000);

    expect(t.committedFrames()).toEqual(range(0, 400));
    for (const socket of t.sockets) {
      expect(socket.frames.length).toBeLessThanOrEqual(FORCE_ROTATE_FRAMES);
    }
  });

  it('reports a missing gateway as provider_not_configured', async () => {
    const t = setup({
      createSession: async () => {
        throw new RealtimeDictationError('PROVIDER_NOT_CONFIGURED', false);
      },
    });
    await t.record(3);

    expect(t.statuses.at(-1)).toMatchObject({
      errorCode: 'provider_not_configured',
      state: 'blocked',
    });
    expect(t.transcriber.resumePoint).toEqual({ startFrame: 0, startSeq: 0 });
  });

  it.each(['SESSION_CREATE_FAILED', 'PROTOCOL_ERROR'] as const)(
    'treats an admission answered without the realtime route (%s) as no gateway',
    async (code) => {
      const t = setup({
        createSession: async () => {
          throw new RealtimeDictationError(code, false);
        },
      });
      await t.record(2);

      expect(t.statuses.at(-1)).toMatchObject({
        errorCode: 'provider_not_configured',
        state: 'blocked',
      });
    },
  );

  it('backs off after a network failure and retries at once when the browser is back online', async () => {
    let offline = true;
    const t = setup({
      createSession: async () => {
        if (offline) throw new RealtimeDictationError('NETWORK_DISCONNECTED', true);
        return admission();
      },
      loud: true,
    });

    await t.record(2);
    expect(t.createSession).toHaveBeenCalledTimes(1);
    expect(t.statuses.at(-1)).toMatchObject({ errorCode: 'network', state: 'reconnecting' });
    expect(t.statuses.at(-1)!.retryInMs).toBeGreaterThan(0);

    offline = false;
    t.online();
    await t.record(3);
    await t.drain(10_000);

    expect(t.committedFrames()).toEqual(range(0, 5));
  });
});
