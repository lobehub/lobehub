import { describe, expect, it, vi } from 'vitest';

import type { MeetingRecorderState } from '@/store/meeting';

import {
  type FrameCapture,
  type LocalTranscriptionSession,
  MeetingRecorderController,
  type MeetingRecorderDeps,
} from './controller';

const frame = () => new Int16Array(3200).fill(8000).buffer;

const createLocalHarness = (session: Partial<LocalTranscriptionSession> = {}) => {
  let recorder: MeetingRecorderState = {
    durationMs: 0,
    live: 'live',
    pendingWindows: 0,
    phase: 'idle',
    segments: [],
  };
  let pushFrame: (frame: ArrayBuffer) => void = () => undefined;
  let onFinal: (segment: { endMs?: number; startMs?: number; text: string }) => void = () =>
    undefined;

  const local: LocalTranscriptionSession = {
    cancel: vi.fn(async () => undefined),
    pause: vi.fn(),
    pushFrame: vi.fn(),
    refine: vi.fn(async () => [
      { endMs: 1500, speakerLabel: 'speaker_1', startMs: 0, text: 'Hello' },
      { endMs: 3000, speakerLabel: 'speaker_2', startMs: 1600, text: 'Hi' },
    ]),
    resume: vi.fn(),
    start: vi.fn(async (handlers) => {
      onFinal = handlers.onFinal;
    }),
    stop: vi.fn(async () => ({ audioPath: '/Users/me/meetings/rec.wav' })),
    ...session,
  };
  const capture: FrameCapture = {
    cancel: vi.fn(async () => undefined),
    start: vi.fn(async (handler) => {
      pushFrame = handler;
    }),
    stop: vi.fn(async () => undefined),
  };
  const api = {
    appendRealtimeSegments: vi.fn(async () => undefined),
    attachAudio: vi.fn(async () => undefined),
    attachLocalAudio: vi.fn(async () => undefined),
    completeLocalRefine: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'mtg_1' })),
    failLocalRefine: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    refine: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    startLocalRefine: vi.fn(async () => undefined),
  };
  const createAudioRecorder = vi.fn(() => ({
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(async () => new Blob(['opus'], { type: 'audio/webm' })),
  }));
  const uploadRecording = vi.fn(async () => 'file_1');

  const deps: MeetingRecorderDeps = {
    api,
    createAudioRecorder,
    createCapture: async () => capture,
    createLocalSession: async () => local,
    frameMs: 200,
    getUserMedia: vi.fn(
      async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream,
    ),
    liveTranscribe: () => vi.fn(async () => 'cloud text'),
    platform: 'desktop',
    refreshMeetings: vi.fn(),
    store: {
      getRecorder: () => recorder,
      getSelectedDeviceId: () => undefined,
      patchRecorder: (patch) => {
        recorder = { ...recorder, ...patch };
      },
      setDevices: vi.fn(),
      setPermission: vi.fn(),
    },
    uploadRecording,
  };

  return {
    api,
    controller: new MeetingRecorderController(deps),
    createAudioRecorder,
    emitFinal: (segment: { endMs?: number; startMs?: number; text: string }) => onFinal(segment),
    local,
    push: (data: ArrayBuffer) => pushFrame(data),
    get recorder() {
      return recorder;
    },
    uploadRecording,
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MeetingRecorderController — desktop local transcription', () => {
  it('records on the device and drafts the live transcript from the local engine', async () => {
    const harness = createLocalHarness();
    await harness.controller.start({ title: 'Local sync' });

    expect(harness.api.create).toHaveBeenCalledWith({
      platform: 'desktop',
      realtimeProvider: 'local',
      refineProvider: 'local',
      title: 'Local sync',
    });
    // The engine keeps the audio; no browser recording is made for upload.
    expect(harness.createAudioRecorder).not.toHaveBeenCalled();

    harness.push(frame());
    expect(harness.local.pushFrame).toHaveBeenCalledTimes(1);

    harness.emitFinal({ endMs: 1200, startMs: 0, text: ' 大家好 ' });
    expect(harness.recorder.segments).toEqual([
      { endMs: 1200, seq: 0, startMs: 0, text: '大家好' },
    ]);
    expect(harness.api.appendRealtimeSegments).toHaveBeenCalledWith('mtg_1', [
      { endMs: 1200, seq: 0, startMs: 0, text: '大家好' },
    ]);
  });

  it('keeps the audio on the device and sends only the refined, diarized text', async () => {
    const harness = createLocalHarness();
    await harness.controller.start({ title: 'Local sync' });
    harness.push(frame());

    await harness.controller.stop();
    await flush();

    expect(harness.uploadRecording).not.toHaveBeenCalled();
    expect(harness.api.attachAudio).not.toHaveBeenCalled();
    expect(harness.api.attachLocalAudio).toHaveBeenCalledWith(
      'mtg_1',
      '/Users/me/meetings/rec.wav',
    );
    expect(harness.api.refine).not.toHaveBeenCalled();
    expect(harness.api.startLocalRefine).toHaveBeenCalledWith('mtg_1');
    expect(harness.local.refine).toHaveBeenCalledWith('/Users/me/meetings/rec.wav');
    expect(harness.api.completeLocalRefine).toHaveBeenCalledWith('mtg_1', [
      { endMs: 1500, speakerLabel: 'speaker_1', startMs: 0, text: 'Hello' },
      { endMs: 3000, speakerLabel: 'speaker_2', startMs: 1600, text: 'Hi' },
    ]);
    expect(harness.recorder.phase).toBe('done');
  });

  it('marks the meeting failed when the device cannot refine the recording', async () => {
    const harness = createLocalHarness({
      refine: vi.fn(async () => {
        throw new Error('model missing');
      }),
    });
    await harness.controller.start({ title: 'Local sync' });
    await harness.controller.stop();
    await flush();

    expect(harness.api.completeLocalRefine).not.toHaveBeenCalled();
    expect(harness.api.failLocalRefine).toHaveBeenCalledWith(
      'mtg_1',
      'transcription_failed',
      'model missing',
    );
  });

  it('falls back to the cloud when the local engine cannot start', async () => {
    const harness = createLocalHarness({
      start: vi.fn(async () => {
        throw new Error('engine crashed');
      }),
    });
    await harness.controller.start({ title: 'Local sync' });

    expect(harness.local.cancel).toHaveBeenCalled();
    expect(harness.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ realtimeProvider: 'cloud', refineProvider: 'cloud' }),
    );
    expect(harness.createAudioRecorder).toHaveBeenCalled();
  });
});
