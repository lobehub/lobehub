import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeetingRecorderState, MicrophonePermission } from '@/store/meeting';

import {
  type AudioRecorder,
  type FrameCapture,
  mapMicrophoneError,
  MeetingRecorderController,
  type MeetingRecorderDeps,
} from './controller';

const voiced = () => new Int16Array(3200).fill(8000).buffer;
const silent = () => new Int16Array(3200).buffer;

const createHarness = (overrides: Partial<MeetingRecorderDeps> = {}) => {
  let recorder: MeetingRecorderState = {
    durationMs: 0,
    live: 'live',
    pendingWindows: 0,
    phase: 'idle',
    segments: [],
  };
  let permission: MicrophonePermission = 'unknown';
  let pushFrame: (frame: ArrayBuffer) => void = () => undefined;

  const capture: FrameCapture = {
    cancel: vi.fn(async () => undefined),
    start: vi.fn(async (onFrame) => {
      pushFrame = onFrame;
    }),
    stop: vi.fn(async () => undefined),
  };
  const audio: AudioRecorder = {
    pause: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(async () => new Blob(['opus'], { type: 'audio/webm' })),
  };
  const api = {
    appendRealtimeSegments: vi.fn(async () => undefined),
    attachAudio: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'mtg_1' })),
    finish: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    refine: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  };
  const transcribe = vi.fn(async () => 'hello world');
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;

  const deps: MeetingRecorderDeps = {
    api,
    createAudioRecorder: () => audio,
    createCapture: async () => capture,
    frameMs: 200,
    getUserMedia: vi.fn(async () => stream),
    liveTranscribe: () => transcribe,
    platform: 'web',
    refreshMeetings: vi.fn(),
    store: {
      getRecorder: () => recorder,
      getSelectedDeviceId: () => 'mic-2',
      patchRecorder: (patch) => {
        recorder = { ...recorder, ...patch };
      },
      setDevices: vi.fn(),
      setPermission: (next) => {
        permission = next;
      },
    },
    uploadRecording: vi.fn(async () => 'file_1'),
    ...overrides,
  };

  return {
    api,
    audio,
    capture,
    controller: new MeetingRecorderController(deps),
    deps,
    get permission() {
      return permission;
    },
    push: (frame: ArrayBuffer) => pushFrame(frame),
    get recorder() {
      return recorder;
    },
    transcribe,
  };
};

describe('mapMicrophoneError', () => {
  it('maps getUserMedia failures to what the user has to do', () => {
    expect(mapMicrophoneError({ name: 'NotAllowedError' })).toBe('permission_denied');
    expect(mapMicrophoneError({ name: 'NotFoundError' })).toBe('no_device');
    expect(mapMicrophoneError(new Error('microphone_not_supported'))).toBe('not_supported');
  });
});

describe('MeetingRecorderController', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('starts on the chosen microphone and creates the meeting', async () => {
    await harness.controller.start({ title: 'Weekly sync' });

    expect(harness.deps.getUserMedia).toHaveBeenCalledWith('mic-2');
    expect(harness.api.create).toHaveBeenCalledWith({
      platform: 'web',
      realtimeProvider: 'cloud',
      refineProvider: 'cloud',
      title: 'Weekly sync',
    });
    expect(harness.permission).toBe('granted');
    expect(harness.recorder).toMatchObject({
      live: 'live',
      meetingId: 'mtg_1',
      phase: 'recording',
      title: 'Weekly sync',
    });
    expect(harness.audio.start).toHaveBeenCalled();
  });

  it('stays idle with the permission guide when the microphone is refused', async () => {
    harness = createHarness({
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      }),
    });

    await harness.controller.start({ title: 'x' });

    expect(harness.recorder).toMatchObject({ error: 'permission_denied', phase: 'idle' });
    expect(harness.permission).toBe('denied');
    expect(harness.api.create).not.toHaveBeenCalled();
  });

  it('reports start_failed and releases the microphone when the meeting cannot be created', async () => {
    harness.api.create.mockRejectedValueOnce(new Error('500'));

    await harness.controller.start({ title: 'x' });

    expect(harness.recorder).toMatchObject({ error: 'start_failed', phase: 'idle' });
    expect(harness.capture.cancel).toHaveBeenCalled();
  });

  it('records audio only when no speech-to-text model is configured', async () => {
    harness = createHarness({ liveTranscribe: () => undefined });

    await harness.controller.start({ title: 'x' });
    for (let index = 0; index < 30; index++) harness.push(voiced());

    expect(harness.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ realtimeProvider: 'none' }),
    );
    expect(harness.recorder.live).toBe('unavailable');
    expect(harness.recorder.durationMs).toBe(6000);
  });

  it('counts recorded time and transcribes closed windows into live segments', async () => {
    await harness.controller.start({ title: 'x' });

    // 4 s of speech, then a pause in speech closes the window.
    for (let index = 0; index < 20; index++) harness.push(voiced());
    harness.push(silent());
    await vi.waitFor(() => expect(harness.recorder.segments).toHaveLength(1));

    expect(harness.recorder.durationMs).toBe(4200);
    expect(harness.recorder.segments[0]).toEqual({
      endMs: 4200,
      seq: 0,
      startMs: 0,
      text: 'hello world',
    });
    expect(harness.api.appendRealtimeSegments).toHaveBeenCalledWith('mtg_1', [
      harness.recorder.segments[0],
    ]);
  });

  it('ignores frames while paused, so paused time is neither recorded nor counted', async () => {
    await harness.controller.start({ title: 'x' });
    harness.push(voiced());

    await harness.controller.pause();
    expect(harness.recorder.phase).toBe('paused');
    expect(harness.audio.pause).toHaveBeenCalled();
    expect(harness.api.pause).toHaveBeenCalledWith('mtg_1');

    harness.push(voiced());
    harness.push(voiced());
    expect(harness.recorder.durationMs).toBe(200);

    await harness.controller.resume();
    harness.push(voiced());
    expect(harness.recorder).toMatchObject({ durationMs: 400, phase: 'recording' });
    expect(harness.api.resume).toHaveBeenCalledWith('mtg_1');
  });

  it('on stop transcribes the tail, finishes, uploads and attaches the audio', async () => {
    await harness.controller.start({ title: 'Weekly sync' });
    for (let index = 0; index < 5; index++) harness.push(voiced());

    await harness.controller.stop();

    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.api.finish).toHaveBeenCalledWith('mtg_1', 1000);
    const [file] = (harness.deps.uploadRecording as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('Weekly sync.webm');
    expect(harness.api.attachAudio).toHaveBeenCalledWith('mtg_1', 'file_1');
    // With the audio stored, the post-recording pass (transcript, then minutes) starts.
    expect(harness.api.refine).toHaveBeenCalledWith('mtg_1');
    expect(harness.recorder).toMatchObject({ error: undefined, phase: 'done' });
    // The recorder must stop before the capture closes the stream.
    expect(
      (harness.audio.stop as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan((harness.capture.stop as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });

  it('keeps the recording after a failed upload and sends it again on retry', async () => {
    const uploadRecording = vi
      .fn<(file: File) => Promise<string>>()
      .mockRejectedValueOnce(new Error('s3 down'))
      .mockResolvedValueOnce('file_2');
    harness = createHarness({ uploadRecording });

    await harness.controller.start({ title: 'x' });
    harness.push(voiced());
    await harness.controller.stop();
    expect(harness.recorder).toMatchObject({ error: 'upload_failed', phase: 'done' });
    expect(harness.api.attachAudio).not.toHaveBeenCalled();
    expect(harness.api.refine).not.toHaveBeenCalled();

    await harness.controller.retryUpload();

    expect(uploadRecording).toHaveBeenCalledTimes(2);
    expect(uploadRecording.mock.calls[1][0]).toBe(uploadRecording.mock.calls[0][0]);
    expect(harness.api.attachAudio).toHaveBeenCalledWith('mtg_1', 'file_2');
    expect(harness.recorder).toMatchObject({ error: undefined, phase: 'done' });
  });

  it('finishes the meeting with the upload retry when it was stopped offline', async () => {
    const uploadRecording = vi
      .fn<(file: File) => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('file_2');
    harness = createHarness({ uploadRecording });
    harness.api.finish.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await harness.controller.start({ title: 'x' });
    harness.push(voiced());
    harness.push(voiced());
    await harness.controller.stop();
    expect(harness.recorder).toMatchObject({ error: 'upload_failed', phase: 'done' });

    await harness.controller.retryUpload();

    // The stop never reached the server, so the retry saves it before the upload.
    expect(harness.api.finish).toHaveBeenCalledTimes(2);
    expect(harness.api.finish).toHaveBeenLastCalledWith('mtg_1', 400);
    expect(harness.api.finish.mock.invocationCallOrder[1]).toBeLessThan(
      harness.api.attachAudio.mock.invocationCallOrder[0],
    );
    expect(harness.api.refine).toHaveBeenCalledWith('mtg_1');
  });

  it('says the upload failed because the connection is down', async () => {
    harness = createHarness({
      network: {
        isNetworkError: (error) => error instanceof TypeError,
        isOnline: () => true,
        waitOnline: async () => undefined,
      },
      uploadRecording: vi
        .fn<(file: File) => Promise<string>>()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('file_2'),
    });

    await harness.controller.start({ title: 'x' });
    harness.push(voiced());
    await harness.controller.stop();
    expect(harness.recorder).toMatchObject({ error: 'upload_offline', phase: 'done' });

    await harness.controller.retryUpload();
    expect(harness.api.attachAudio).toHaveBeenCalledWith('mtg_1', 'file_2');
    expect(harness.recorder.error).toBeUndefined();
  });

  it('ignores a second start while a meeting is recording', async () => {
    await harness.controller.start({ title: 'x' });
    await harness.controller.start({ title: 'y' });

    expect(harness.api.create).toHaveBeenCalledTimes(1);
  });
});
