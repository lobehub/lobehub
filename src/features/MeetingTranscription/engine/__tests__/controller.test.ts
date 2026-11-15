import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealtimeDictationError } from '@/features/ChatInput/Dictation/contract';

import type { MeetingRecorderDependencies } from '../controller';
import { MeetingRecorder } from '../controller';
import { admission, FakeGatewaySocket, markedFrame } from './fakeGateway';

const fakeStream = () => ({ getTracks: () => [] }) as unknown as MediaStream;

const setup = (overrides: Partial<MeetingRecorderDependencies> = {}) => {
  let onFrame: ((frame: ArrayBuffer) => void) | undefined;
  const api = {
    appendRealtimeSegments: vi.fn(async () => undefined),
    attachAudio: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'mtg_1' })),
    finish: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    refine: vi.fn(async () => ({ status: 'ready' })),
    resume: vi.fn(async () => undefined),
    transcribeWindow: vi.fn(async (_id: string, request: { seq: number }) => ({
      text: `w${request.seq}`,
    })),
  };
  const deps: MeetingRecorderDependencies = {
    api,
    createCapture: async () => ({
      cancel: async () => undefined,
      start: async (handler) => {
        onFrame = handler;
      },
      stop: async () => {
        onFrame = undefined;
      },
    }),
    createGatewaySession: vi.fn(async () => admission()),
    createWebSocket: (url) => new FakeGatewaySocket(url),
    platform: 'web',
    requestMicrophone: vi.fn(async () => fakeStream()),
    uploadRecording: vi.fn(async () => 'file_1'),
    ...overrides,
  };
  const recorder = new MeetingRecorder(deps);
  let index = 0;
  const speak = async (frames: number) => {
    for (let i = 0; i < frames; i += 1) {
      onFrame?.(markedFrame(index++, true));
      await vi.advanceTimersByTimeAsync(200);
    }
  };
  const settle = async (ms = 30_000) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  return { api, deps, recorder, settle, speak };
};

describe('MeetingRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MeetingRecorder.gatewayUnavailable = false;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records past 60 s over the gateway, persists the draft, then uploads and refines', async () => {
    const t = setup();
    await t.recorder.start({ title: 'Weekly' });
    expect(t.recorder.getSnapshot().phase).toBe('recording');

    await t.speak(400); // 80 s
    const stopped = t.recorder.stop();
    await t.settle();
    await stopped;

    const snapshot = t.recorder.getSnapshot();
    expect(snapshot.phase).toBe('done');
    expect(snapshot.refine).toEqual({ status: 'ready' });
    expect(snapshot.durationMs).toBe(80_000);
    // The draft spans more than one gateway session and every segment was saved.
    const saved = t.api.appendRealtimeSegments.mock.calls.flatMap((call: any[]) => call[1]);
    expect(saved.map((s: { seq: number }) => s.seq)).toEqual(snapshot.segments.map((s) => s.seq));
    expect(saved.at(-1).endMs).toBe(80_000);
    expect(t.api.finish).toHaveBeenCalledWith('mtg_1', 80_000);
    const [file] = (t.deps.uploadRecording as any).mock.calls[0];
    expect(file.size).toBe(44 + 400 * 6400);
    expect(t.api.attachAudio).toHaveBeenCalledWith('mtg_1', 'file_1');
    expect(t.api.refine).toHaveBeenCalledWith('mtg_1');
  });

  it('falls back to windowed transcription when no gateway is deployed, keeping the first words', async () => {
    const t = setup({
      createGatewaySession: vi.fn(async () => {
        throw new RealtimeDictationError('PROVIDER_NOT_CONFIGURED', false);
      }),
    });
    await t.recorder.start({ title: 'Self-hosted' });
    await t.speak(130); // 26 s
    await t.settle(0);

    const snapshot = t.recorder.getSnapshot();
    expect(snapshot.live.mode).toBe('window');
    // The first window starts at 0: audio recorded while the gateway was tried is not lost.
    expect(t.api.transcribeWindow.mock.calls[0][1]).toMatchObject({ seq: 0, startMs: 0 });
    expect(snapshot.segments[0]).toMatchObject({ seq: 0, text: 'w0' });
    expect(MeetingRecorder.gatewayUnavailable).toBe(true);
  });

  it('explains a denied microphone and lets the user try again', async () => {
    const denied = new DOMException('denied', 'NotAllowedError');
    const requestMicrophone = vi
      .fn<() => Promise<MediaStream>>()
      .mockRejectedValueOnce(denied)
      .mockResolvedValue(fakeStream());
    const t = setup({ requestMicrophone });

    await t.recorder.start({ title: 'x' });
    expect(t.recorder.getSnapshot()).toMatchObject({
      error: 'microphone_permission_denied',
      phase: 'idle',
    });
    expect(t.api.create).not.toHaveBeenCalled();

    await t.recorder.start({ title: 'x' });
    expect(t.recorder.getSnapshot().phase).toBe('recording');
    expect(t.recorder.getSnapshot().error).toBeUndefined();
  });

  it('keeps the recording after a failed upload and finishes on retry', async () => {
    const uploadRecording = vi
      .fn<(file: File) => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('file_2');
    const t = setup({ uploadRecording });
    await t.recorder.start({ title: 'x' });
    await t.speak(10);
    const stopped = t.recorder.stop();
    await t.settle();
    await stopped;

    expect(t.recorder.getSnapshot()).toMatchObject({ error: 'upload_failed', phase: 'finishing' });

    await t.recorder.retryProcessing();
    expect(t.api.finish).toHaveBeenCalledTimes(1);
    expect(uploadRecording.mock.calls[1][0].size).toBe(44 + 10 * 6400);
    expect(t.recorder.getSnapshot()).toMatchObject({ phase: 'done', refine: { status: 'ready' } });
  });

  it('surfaces a refine failure code and retries the refine alone', async () => {
    const t = setup();
    t.api.refine
      .mockResolvedValueOnce({ error: { code: 'quota_exceeded' }, status: 'failed' } as any)
      .mockResolvedValueOnce({ status: 'ready' });
    await t.recorder.start({ title: 'x' });
    await t.speak(5);
    const stopped = t.recorder.stop();
    await t.settle();
    await stopped;

    expect(t.recorder.getSnapshot().refine).toEqual({
      errorCode: 'quota_exceeded',
      status: 'failed',
    });

    await t.recorder.retryProcessing();
    expect(t.deps.uploadRecording).toHaveBeenCalledTimes(1);
    expect(t.recorder.getSnapshot().refine).toEqual({ status: 'ready' });
  });

  it('pauses without losing the timeline and resumes on a fresh capture', async () => {
    const t = setup();
    await t.recorder.start({ title: 'x' });
    await t.speak(10);
    await t.recorder.pause();
    expect(t.recorder.getSnapshot().phase).toBe('paused');
    expect(t.api.pause).toHaveBeenCalledWith('mtg_1');

    await t.recorder.resume();
    await t.speak(10);
    expect(t.recorder.getSnapshot()).toMatchObject({ durationMs: 4000, phase: 'recording' });
  });
});
