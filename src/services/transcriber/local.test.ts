import type { LocalAsrRealtimeEvent, LocalAsrTranscriptEvent } from '@lobechat/electron-client-ipc';
import { describe, expect, it, vi } from 'vitest';

import { parseRealtimeAsrServerEvent } from '@/features/ChatInput/Dictation/contract';

import { LocalBatchTranscriber, LocalRealtimeTranscriber } from './local';

const SESSION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const transcript = (
  type: LocalAsrTranscriptEvent['type'],
  text: string,
  sequence: number,
  sessionId = SESSION_ID,
): LocalAsrTranscriptEvent => ({
  endMs: 2400,
  segmentId: 'seg-1',
  sequence,
  sessionId,
  startMs: 0,
  text,
  type,
});

const createHarness = () => {
  const listeners = new Map<string, Set<(data: any) => void>>();
  const subscribe = vi.fn((event: string, listener: (data: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return () => listeners.get(event)!.delete(listener);
  });
  const broadcast = (event: string, data: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(data);
  };

  let resolveStart!: (value: { sessionId: string }) => void;
  const service = {
    cancelSession: vi.fn(async () => {}),
    pushAudio: vi.fn(async () => {}),
    startSession: vi.fn(
      () =>
        new Promise<{ sessionId: string }>((resolve) => {
          resolveStart = resolve;
        }),
    ),
    stopSession: vi.fn(async () => ({
      stats: { audioMs: 2400, decodeMaxMs: 40, decodeP50Ms: 30, rtf: 0.02, segments: 1 },
    })),
    transcribeFile: vi.fn(),
  };

  return {
    broadcast,
    listeners,
    resolveStart: (sessionId = SESSION_ID) => resolveStart({ sessionId }),
    service,
    subscribe,
  };
};

describe('local transcript events', () => {
  it('pass the cloud realtime ASR protocol parser unchanged', () => {
    for (const type of ['transcript.partial', 'transcript.final'] as const) {
      const event = transcript(type, '大家好', 2);
      expect(parseRealtimeAsrServerEvent(JSON.stringify(event))).toMatchObject({
        segmentId: 'seg-1',
        sessionId: SESSION_ID,
        text: '大家好',
        type,
      });
    }
  });
});

describe('LocalRealtimeTranscriber', () => {
  it('replays events that arrive before startSession resolves and routes only its session', async () => {
    const harness = createHarness();
    const onFinal = vi.fn();
    const onPartial = vi.fn();
    const transcriber = new LocalRealtimeTranscriber(harness);

    const started = transcriber.start({ language: 'zh', onFinal, onPartial, recordAudio: true });
    // session.ready / early transcript can beat the IPC response
    harness.broadcast('localAsrEvent', transcript('transcript.partial', '大家', 2));
    harness.resolveStart();
    await started;

    harness.broadcast('localAsrEvent', transcript('transcript.final', '大家好', 3));
    harness.broadcast(
      'localAsrEvent',
      transcript('transcript.final', 'other', 1, '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'),
    );

    expect(harness.service.startSession).toHaveBeenCalledWith({
      language: 'zh',
      recordAudio: true,
    });
    expect(onPartial).toHaveBeenCalledWith({ endMs: 2400, id: 'seg-1', startMs: 0, text: '大家' });
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith({ endMs: 2400, id: 'seg-1', startMs: 0, text: '大家好' });
  });

  it('queues frames until the session exists and drops frames while paused', async () => {
    const harness = createHarness();
    const transcriber = new LocalRealtimeTranscriber(harness);
    const frame = new ArrayBuffer(6400);

    const started = transcriber.start({ onFinal: vi.fn() });
    transcriber.pushFrame(frame);
    expect(harness.service.pushAudio).not.toHaveBeenCalled();
    harness.resolveStart();
    await started;
    expect(harness.service.pushAudio).toHaveBeenCalledTimes(1);
    expect(harness.service.pushAudio).toHaveBeenCalledWith({
      frame: new Uint8Array(frame),
      sessionId: SESSION_ID,
    });

    transcriber.pause();
    transcriber.pushFrame(frame);
    transcriber.resume();
    transcriber.pushFrame(frame);
    expect(harness.service.pushAudio).toHaveBeenCalledTimes(2);
  });

  it('reports engine errors and unsubscribes after stop', async () => {
    const harness = createHarness();
    const onError = vi.fn();
    const transcriber = new LocalRealtimeTranscriber(harness);

    const started = transcriber.start({ onError, onFinal: vi.fn() });
    harness.resolveStart();
    await started;
    const crash: LocalAsrRealtimeEvent = {
      code: 'ENGINE_CRASHED',
      message: 'engine_exited:1',
      retryable: true,
      sequence: 0,
      sessionId: SESSION_ID,
      type: 'session.error',
    };
    harness.broadcast('localAsrEvent', crash);
    expect(onError).toHaveBeenCalledWith({
      code: 'ENGINE_CRASHED',
      message: 'engine_exited:1',
      retryable: true,
    });

    const result = await transcriber.stop();
    expect(result.stats?.rtf).toBe(0.02);
    expect(harness.service.stopSession).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    expect(harness.listeners.get('localAsrEvent')?.size).toBe(0);
  });
});

describe('LocalBatchTranscriber', () => {
  it('forwards only its own job progress and maps the result', async () => {
    const harness = createHarness();
    const onProgress = vi.fn();
    harness.service.transcribeFile.mockImplementation(async ({ jobId }: { jobId: string }) => {
      harness.broadcast('localAsrJobProgress', { jobId, phase: 'transcribing', progress: 0.5 });
      harness.broadcast('localAsrJobProgress', { jobId: 'other', phase: 'loading', progress: 0 });
      return {
        audioMs: 1000,
        segments: [{ endMs: 900, id: 'seg-1', speaker: 'speaker_1', startMs: 0, text: 'hi' }],
        speakers: ['speaker_1'],
        stats: { rtf: 0.07 },
      };
    });

    const result = await new LocalBatchTranscriber(harness).transcribe({
      diarize: true,
      filePath: '/tmp/meeting.wav',
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'transcribing', progress: 0.5 }),
    );
    expect(result.speakers).toEqual(['speaker_1']);
    expect(harness.service.transcribeFile).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: true, filePath: '/tmp/meeting.wav' }),
    );
    expect(harness.listeners.get('localAsrJobProgress')?.size).toBe(0);
  });
});
