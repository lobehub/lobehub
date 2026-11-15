import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LocalAsrRealtimeEvent } from '@lobechat/electron-client-ipc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalAsrEngine, type SherpaRuntime, type SherpaVad } from '../engine';

const SAMPLE_RATE = 16_000;
const SESSION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const MODELS = { model: '/m/model.onnx', tokens: '/m/tokens.txt', vad: '/m/vad.onnx' };

/**
 * Fake VAD: treats |sample| >= 0.5 as speech and closes an utterance after
 * 0.3 s of silence, mirroring silero's `minSilenceDuration`.
 */
class FakeVad implements SherpaVad {
  frontCalls: (boolean | undefined)[] = [];
  private done: { samples: Float32Array; start: number }[] = [];
  private speech: number[] = [];
  private speechStart = 0;
  private silence = 0;
  private position = 0;

  acceptWaveform(samples: Float32Array) {
    for (const sample of samples) {
      if (Math.abs(sample) >= 0.5) {
        if (this.speech.length === 0) this.speechStart = this.position;
        this.speech.push(sample);
        this.silence = 0;
      } else if (this.speech.length > 0) {
        this.silence += 1;
        if (this.silence >= SAMPLE_RATE * 0.3) this.close();
      }
      this.position += 1;
    }
  }

  flush() {
    if (this.speech.length > 0) this.close();
  }

  front(enableExternalBuffer?: boolean) {
    this.frontCalls.push(enableExternalBuffer);
    return this.done[0];
  }

  isDetected() {
    return this.speech.length > SAMPLE_RATE * 0.25;
  }

  isEmpty() {
    return this.done.length === 0;
  }

  pop() {
    this.done.shift();
  }

  private close() {
    this.done.push({ samples: Float32Array.from(this.speech), start: this.speechStart });
    this.speech = [];
    this.silence = 0;
  }
}

const createRuntime = () => {
  const vads: FakeVad[] = [];
  const recognizerConfigs: unknown[] = [];
  const runtime: SherpaRuntime = {
    LinearResampler: class {
      flush(samples: Float32Array) {
        return samples;
      }
    } as unknown as SherpaRuntime['LinearResampler'],
    OfflineRecognizer: class {
      constructor(config: unknown) {
        recognizerConfigs.push(config);
      }
      createStream() {
        const stream: { samples: Float32Array } = { samples: new Float32Array(0) };
        return {
          ...stream,
          acceptWaveform: ({ samples }: { samples: Float32Array }) => {
            stream.samples = samples;
          },
          stream,
        };
      }
      decode() {}
      getResult(stream: { stream: { samples: Float32Array } }) {
        return { text: ` ${(stream.stream.samples.length / SAMPLE_RATE).toFixed(1)}s of speech ` };
      }
    } as unknown as SherpaRuntime['OfflineRecognizer'],
    OfflineSpeakerDiarization: class {
      process() {
        return [
          { end: 1.6, speaker: 3, start: 0 },
          { end: 4, speaker: 0, start: 1.6 },
        ];
      }
    } as unknown as SherpaRuntime['OfflineSpeakerDiarization'],
    Vad: class {
      constructor() {
        const vad = new FakeVad();
        vads.push(vad);
        return vad;
      }
    } as unknown as SherpaRuntime['Vad'],
    readWave: () => ({ sampleRate: SAMPLE_RATE, samples: speechPlan([1, 0.5, 1.2, 1]) }),
  };
  return { recognizerConfigs, runtime, vads };
};

/** Alternating speech / silence durations in seconds, starting with speech. */
function speechPlan(durations: number[]) {
  const total = durations.reduce((sum, value) => sum + value, 0);
  const samples = new Float32Array(Math.round(total * SAMPLE_RATE));
  let offset = 0;
  durations.forEach((duration, index) => {
    const length = Math.round(duration * SAMPLE_RATE);
    if (index % 2 === 0) samples.fill(0.8, offset, offset + length);
    offset += length;
  });
  return samples;
}

const toPcmFrames = (samples: Float32Array) => {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(Math.round(sample * 32_767), index * 2));
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += 6400) {
    frames.push(new Uint8Array(pcm.subarray(offset, offset + 6400)));
  }
  return frames;
};

describe('LocalAsrEngine realtime session', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'local-asr-engine-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('streams partials then finals with the same segment id and cloud-style envelopes', async () => {
    const { runtime, vads, recognizerConfigs } = createRuntime();
    const events: LocalAsrRealtimeEvent[] = [];
    let clock = 0;
    const engine = new LocalAsrEngine({
      emitEvent: (event) => events.push(event),
      emitProgress: () => {},
      now: () => (clock += 5),
      runtime,
    });
    const recordPath = path.join(dir, 'session.wav');

    engine.startSession({ language: 'zh', models: MODELS, recordPath, sessionId: SESSION_ID });
    for (const frame of toPcmFrames(speechPlan([2.4, 0.6, 1, 0.4])))
      engine.pushAudio(SESSION_ID, frame);
    const result = await engine.stopSession(SESSION_ID);

    expect(events[0]).toMatchObject({ sequence: 1, sessionId: SESSION_ID, type: 'session.ready' });
    const transcripts = events.filter(
      (event): event is Extract<LocalAsrRealtimeEvent, { segmentId: string }> =>
        event.type === 'transcript.partial' || event.type === 'transcript.final',
    );
    const finals = transcripts.filter((event) => event.type === 'transcript.final');
    expect(finals.map((event) => [event.segmentId, event.text])).toEqual([
      ['seg-1', '2.4s of speech'],
      ['seg-2', '1.0s of speech'],
    ]);
    expect(finals[0]).toMatchObject({ endMs: 2400, startMs: 0 });
    expect(finals[1]).toMatchObject({ endMs: 4000, startMs: 3000 });

    const firstPartial = transcripts.find((event) => event.type === 'transcript.partial');
    expect(firstPartial?.segmentId).toBe('seg-1');
    expect(transcripts.indexOf(firstPartial!)).toBeLessThan(transcripts.indexOf(finals[0]));

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1)).toMatchObject({ audioPath: recordPath, type: 'session.completed' });
    expect(result.stats).toMatchObject({ audioMs: 4400, segments: 2 });

    // Electron rejects addon-owned external buffers; every front() must opt out.
    expect(vads[0].frontCalls.every((value) => value === false)).toBe(true);
    expect(recognizerConfigs[0]).toMatchObject({
      modelConfig: { senseVoice: { language: 'zh', model: MODELS.model }, tokens: MODELS.tokens },
    });

    const wav = await readFile(recordPath);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt32LE(40)).toBe(4.4 * SAMPLE_RATE * 2);
  });

  it('reuses the loaded recognizer across sessions', () => {
    const { runtime, recognizerConfigs } = createRuntime();
    const engine = new LocalAsrEngine({ emitEvent: () => {}, emitProgress: () => {}, runtime });

    engine.startSession({ language: 'zh', models: MODELS, sessionId: SESSION_ID });
    const second = engine.startSession({
      language: 'zh',
      models: MODELS,
      sessionId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    });

    expect(recognizerConfigs).toHaveLength(1);
    expect(second.loadMs).toBe(0);
  });
});

describe('LocalAsrEngine.transcribeFile', () => {
  it('returns timestamped segments with renumbered speakers and progress', async () => {
    const { runtime } = createRuntime();
    const progress: string[] = [];
    const engine = new LocalAsrEngine({
      emitEvent: () => {},
      emitProgress: (payload) => progress.push(payload.phase),
      peakRssMb: () => 900,
      runtime,
    });

    const result = await engine.transcribeFile({
      diarization: { embedding: '/m/campplus.onnx', segmentation: '/m/pyannote.onnx' },
      filePath: '/tmp/meeting.wav',
      jobId: 'job-1',
      language: 'zh',
      models: MODELS,
    });

    expect(result.audioMs).toBe(3700);
    expect(result.segments).toEqual([
      { endMs: 1000, id: 'seg-1', speaker: 'speaker_1', startMs: 0, text: '1.0s of speech' },
      { endMs: 2700, id: 'seg-2', speaker: 'speaker_2', startMs: 1500, text: '1.2s of speech' },
    ]);
    expect(result.speakers).toEqual(['speaker_1', 'speaker_2']);
    expect(result.stats.peakRssMb).toBe(900);
    expect(progress[0]).toBe('loading');
    expect(progress).toContain('transcribing');
    expect(progress).toContain('diarization');
  });

  it('skips diarization when no speaker models are given', async () => {
    const { runtime } = createRuntime();
    const engine = new LocalAsrEngine({ emitEvent: () => {}, emitProgress: () => {}, runtime });

    const result = await engine.transcribeFile({
      filePath: '/tmp/meeting.wav',
      jobId: 'job-2',
      language: 'zh',
      models: MODELS,
    });

    expect(result.speakers).toEqual([]);
    expect(result.segments.every((segment) => segment.speaker === undefined)).toBe(true);
    expect(result.stats.diarizationMs).toBeUndefined();
  });
});
