import { describe, expect, it, vi } from 'vitest';

import { LiveTranscriber } from './liveTranscriber';
import type { LiveWindow } from './liveWindows';

const window = (startMs: number, voiced = true): LiveWindow => ({
  endMs: startMs + 1000,
  frames: [],
  startMs,
  voiced,
});

const setup = (transcribe: (window: LiveWindow) => Promise<string>) => {
  const onSegment = vi.fn();
  const onStatus = vi.fn();
  const transcriber = new LiveTranscriber({
    onSegment,
    onStatus,
    transcribe,
    wait: () => Promise.resolve(),
  });
  return { onSegment, onStatus, transcriber };
};

describe('LiveTranscriber', () => {
  it('emits segments in recording order with sequential seq, even when requests finish out of order', async () => {
    const { onSegment, transcriber } = setup(async (w) => {
      // The first window is the slowest; order must still follow the recording.
      await new Promise((resolve) => setTimeout(resolve, w.startMs === 0 ? 20 : 0));
      return `text at ${w.startMs}`;
    });

    transcriber.enqueue(window(0));
    transcriber.enqueue(window(1000));
    transcriber.enqueue(window(2000));
    await transcriber.drain(1000);

    expect(onSegment.mock.calls.map(([segment]) => segment)).toEqual([
      { endMs: 1000, seq: 0, startMs: 0, text: 'text at 0' },
      { endMs: 2000, seq: 1, startMs: 1000, text: 'text at 1000' },
      { endMs: 3000, seq: 2, startMs: 2000, text: 'text at 2000' },
    ]);
  });

  it('skips silent windows and blank results without a request or a segment', async () => {
    const transcribe = vi.fn(async () => '   ');
    const { onSegment, transcriber } = setup(transcribe);

    transcriber.enqueue(window(0, false));
    transcriber.enqueue(undefined);
    transcriber.enqueue(window(1000));
    await transcriber.drain(1000);

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onSegment).not.toHaveBeenCalled();
  });

  it('retries a failed window and recovers without losing its text', async () => {
    const transcribe = vi
      .fn<(w: LiveWindow) => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('recovered');
    const { onSegment, transcriber } = setup(transcribe);

    transcriber.enqueue(window(0));
    await transcriber.drain(1000);

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(onSegment).toHaveBeenCalledWith(expect.objectContaining({ text: 'recovered' }));
  });

  it('reports lagging after the last retry, then live again once a window succeeds', async () => {
    const transcribe = vi.fn<(w: LiveWindow) => Promise<string>>(async (w) => {
      if (w.startMs === 0) throw new Error('down');
      return 'back';
    });
    const { onStatus, transcriber } = setup(transcribe);

    transcriber.enqueue(window(0));
    await transcriber.drain(1000);
    expect(onStatus).toHaveBeenLastCalledWith({ pendingWindows: 0, state: 'lagging' });
    // 1 attempt + 3 retries
    expect(transcribe).toHaveBeenCalledTimes(4);

    transcriber.enqueue(window(1000));
    await transcriber.drain(1000);
    expect(onStatus).toHaveBeenLastCalledWith({ pendingWindows: 0, state: 'live' });
  });

  it('gives up waiting at the drain timeout', async () => {
    const { transcriber } = setup(() => new Promise<string>(() => undefined));
    transcriber.enqueue(window(0));

    await expect(transcriber.drain(10)).resolves.toBe(false);
  });

  it('holds windows while offline and transcribes all of them once the connection is back', async () => {
    let online = true;
    let reconnect: () => void = () => undefined;
    const network = {
      isNetworkError: (error: unknown) => error instanceof TypeError,
      isOnline: () => online,
      waitOnline: () =>
        new Promise<void>((resolve) => {
          reconnect = () => {
            online = true;
            resolve();
          };
        }),
    };
    const transcribe = vi.fn(async (w: LiveWindow) => {
      // The connection drops while the second window is in flight.
      if (w.startMs === 1000 && transcribe.mock.calls.length === 2) {
        online = false;
        throw new TypeError('Failed to fetch');
      }
      return `text at ${w.startMs}`;
    });
    const onSegment = vi.fn();
    const onStatus = vi.fn();
    const transcriber = new LiveTranscriber({
      network,
      onSegment,
      onStatus,
      transcribe,
      wait: () => Promise.resolve(),
    });

    transcriber.enqueue(window(0));
    transcriber.enqueue(window(1000));
    transcriber.enqueue(window(2000));
    transcriber.enqueue(window(3000));
    await expect(transcriber.drain(20)).resolves.toBe(false);
    expect(onStatus).toHaveBeenLastCalledWith({ pendingWindows: 3, state: 'offline' });

    reconnect();
    await expect(transcriber.drain(1000)).resolves.toBe(true);

    expect(onSegment.mock.calls.map(([segment]) => segment.text)).toEqual([
      'text at 0',
      'text at 1000',
      'text at 2000',
      'text at 3000',
    ]);
    expect(onStatus).toHaveBeenLastCalledWith({ pendingWindows: 0, state: 'live' });
  });

  it('waits out an outage the browser does not report, probing until requests go through', async () => {
    let down = false;
    const waitOnline = vi.fn(async () => {
      // Each probe interval; the connection comes back after the third one.
      if (waitOnline.mock.calls.length >= 3) down = false;
    });
    const transcribe = vi.fn(async (w: LiveWindow) => {
      if (down) throw new TypeError('Failed to fetch');
      if (w.startMs === 1000 && transcribe.mock.calls.length === 2) {
        down = true;
        throw new TypeError('Failed to fetch');
      }
      return `text at ${w.startMs}`;
    });
    const onSegment = vi.fn();
    const onStatus = vi.fn();
    const transcriber = new LiveTranscriber({
      network: {
        isNetworkError: (error) => error instanceof TypeError,
        isOnline: () => true,
        waitOnline,
      },
      onSegment,
      onStatus,
      transcribe,
      wait: () => Promise.resolve(),
    });

    transcriber.enqueue(window(0));
    transcriber.enqueue(window(1000));
    transcriber.enqueue(window(2000));
    await expect(transcriber.drain(1000)).resolves.toBe(true);

    expect(onStatus.mock.calls.some(([status]) => status.state === 'offline')).toBe(true);
    expect(onSegment.mock.calls.map(([segment]) => segment.text)).toEqual([
      'text at 0',
      'text at 1000',
      'text at 2000',
    ]);
    expect(onStatus).toHaveBeenLastCalledWith({ pendingWindows: 0, state: 'live' });
  });
});
