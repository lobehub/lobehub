import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FrameLedger } from '../frameLedger';
import type { LiveSegment, LiveTranscriberStatus } from '../types';
import type { WindowRequest } from '../windowTranscriber';
import {
  LiveTranscriptionError,
  WINDOW_MAX_FRAMES,
  WINDOW_MIN_FRAMES,
  WindowTranscriber,
} from '../windowTranscriber';
import { markedFrame } from './fakeGateway';

const setup = (transcribe: (request: WindowRequest) => Promise<{ text: string }>, loud = true) => {
  const ledger = new FrameLedger();
  const segments: LiveSegment[] = [];
  const statuses: LiveTranscriberStatus[] = [];
  let onlineListener: (() => void) | undefined;
  const transcriber = new WindowTranscriber({
    ledger,
    onOnline: (listener) => {
      onlineListener = listener;
      return () => undefined;
    },
    onSegments: (batch) => segments.push(...batch),
    onStatus: (status) => statuses.push(status),
    transcribe,
  });
  transcriber.start();

  const record = async (count: number, frameLoud = loud) => {
    for (let i = 0; i < count; i += 1) {
      ledger.append(markedFrame(ledger.length, frameLoud));
      transcriber.notifyFrame();
      await vi.advanceTimersByTimeAsync(200);
    }
  };
  const drain = async (ms: number) => {
    const done = transcriber.drain(ms);
    await vi.advanceTimersByTimeAsync(ms);
    return done;
  };

  return {
    drain,
    ledger,
    online: () => onlineListener?.(),
    record,
    segments,
    statuses,
    transcriber,
  };
};

/** A fake server keyed by seq, as `meeting.transcribeLive` stores rows. */
const fakeServer = () => {
  const rows = new Map<number, WindowRequest>();
  const calls: WindowRequest[] = [];
  return {
    calls,
    rows,
    transcribe: vi.fn(async (request: WindowRequest) => {
      calls.push(request);
      rows.set(request.seq, request);
      return { text: `w${request.seq}` };
    }),
  };
};

describe('WindowTranscriber', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts continuous speech at 25 s and covers every frame of a 2-minute meeting once', async () => {
    const server = fakeServer();
    const t = setup(server.transcribe);
    await t.record(600);
    expect(await t.drain(5000)).toBe(true);

    const windows = [...server.rows.values()].sort((a, b) => a.seq - b.seq);
    expect(windows[0]).toMatchObject({ endMs: WINDOW_MAX_FRAMES * 200, startMs: 0 });
    // Windows tile the recording with no gap or overlap.
    windows.forEach((window, index) => {
      if (index > 0) expect(window.startMs).toBe(windows[index - 1].endMs);
      expect(window.endMs - window.startMs).toBeLessThanOrEqual(WINDOW_MAX_FRAMES * 200);
    });
    expect(windows.at(-1)!.endMs).toBe(600 * 200);
    expect(t.segments.map((s) => s.seq)).toEqual(windows.map((w) => w.seq));
  });

  it('cuts at the first pause after 10 s', async () => {
    const server = fakeServer();
    const t = setup(server.transcribe, false);
    await t.record(WINDOW_MIN_FRAMES + 3);

    expect(server.calls[0]).toMatchObject({ endMs: WINDOW_MIN_FRAMES * 200, startMs: 0 });
  });

  it('re-sends a failed window with the same seq, so a lost response never duplicates text', async () => {
    const server = fakeServer();
    let failures = 2;
    const t = setup(async (request) => {
      const result = await server.transcribe(request);
      // The server stored the row, but the response never made it back.
      if (failures-- > 0) throw new LiveTranscriptionError('network');
      return result;
    });

    await t.record(WINDOW_MAX_FRAMES);
    expect(t.statuses.at(-1)).toMatchObject({ errorCode: 'network', state: 'reconnecting' });
    await t.record(20);
    await t.drain(10_000);

    const seqs = server.calls.map((call) => call.seq);
    expect(seqs.slice(0, 3)).toEqual([0, 0, 0]);
    // One stored row per window despite three attempts.
    expect(server.rows.size).toBe(2);
    expect(t.segments.map((s) => s.text)).toEqual(['w0', 'w1']);
  });

  it('stops on a missing model and catches up the backlog after retry', async () => {
    const server = fakeServer();
    let configured = false;
    const t = setup(async (request) => {
      if (!configured) throw new LiveTranscriptionError('provider_not_configured');
      return server.transcribe(request);
    });

    await t.record(WINDOW_MAX_FRAMES * 3);
    expect(t.statuses.at(-1)).toMatchObject({
      errorCode: 'provider_not_configured',
      state: 'blocked',
    });
    expect(t.statuses.at(-1)!.pendingMs).toBe(WINDOW_MAX_FRAMES * 3 * 200);

    configured = true;
    t.transcriber.retry();
    await t.drain(5000);

    expect([...server.rows.keys()].sort()).toEqual([0, 1, 2]);
    expect(t.statuses.at(-1)).toMatchObject({ pendingMs: 0, state: 'live' });
  });

  it('retries immediately when the browser comes back online', async () => {
    const server = fakeServer();
    let offline = true;
    const t = setup(async (request) => {
      if (offline) throw new LiveTranscriptionError('network');
      return server.transcribe(request);
    });

    await t.record(WINDOW_MAX_FRAMES);
    offline = false;
    t.online();
    await vi.advanceTimersByTimeAsync(0);

    expect(server.rows.has(0)).toBe(true);
  });

  it('closes the open window on pause', async () => {
    const server = fakeServer();
    const t = setup(server.transcribe);
    await t.record(7);
    t.transcriber.pause();
    await vi.advanceTimersByTimeAsync(0);

    expect(server.calls).toEqual([expect.objectContaining({ endMs: 1400, seq: 0, startMs: 0 })]);
  });
});
