import type {
  LocalAsrJobProgressPayload,
  LocalAsrLanguage,
  LocalAsrRealtimeEvent,
  LocalAsrSessionStats,
  LocalAsrTranscribeFileResult,
  LocalAsrTranscriptSegment,
} from '@lobechat/electron-client-ipc';

import { assignSpeakers, type DiarizationTurn } from './merge';
import { pcm16ToFloat32, SAMPLE_RATE, WavRecorder } from './wav';

/** The subset of `sherpa-onnx-node` the engine uses (injected so tests can fake it). */
export interface SherpaRuntime {
  LinearResampler: new (
    input: number,
    output: number,
  ) => { flush: (samples: Float32Array) => Float32Array };
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  OfflineSpeakerDiarization: new (config: unknown) => {
    process: (samples: Float32Array) => DiarizationTurn[];
  };
  readWave: (
    filePath: string,
    enableExternalBuffer?: boolean,
  ) => {
    sampleRate: number;
    samples: Float32Array;
  };
  Vad: new (config: unknown, bufferSeconds: number) => SherpaVad;
}

export interface SherpaRecognizer {
  createStream: () => {
    acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void;
  };
  decode: (stream: any) => void;
  getResult: (stream: any) => { text: string };
}

export interface SherpaVad {
  acceptWaveform: (samples: Float32Array) => void;
  flush: () => void;
  front: (enableExternalBuffer?: boolean) => { samples: Float32Array; start: number };
  isDetected: () => boolean;
  isEmpty: () => boolean;
  pop: () => void;
}

export interface AsrModelPaths {
  model: string;
  tokens: string;
  vad: string;
}

export interface DiarizationModelPaths {
  embedding: string;
  segmentation: string;
}

export const ENGINE_NAME = 'sherpa-onnx SenseVoice-small int8 + silero VAD';

const VAD_WINDOW = 512;
/** Re-decode the open utterance this often (in audio time) to show a partial. */
const PARTIAL_INTERVAL_SAMPLES = SAMPLE_RATE * 0.8;
const MIN_PARTIAL_SAMPLES = SAMPLE_RATE * 0.6;
/** silero needs ~250 ms of speech before `isDetected()`; back-date the utterance start. */
const SPEECH_PREROLL_SAMPLES = SAMPLE_RATE * 0.4;
const MAX_UTTERANCE_SECONDS = 20;
const ROLLING_SAMPLES = SAMPLE_RATE * (MAX_UTTERANCE_SECONDS + 5);
/** T-810: 0.5 (default) over-splits speakers badly; 0.8 matched 84/84 turns. */
const DIARIZATION_THRESHOLD = 0.8;

const NUM_THREADS = 4;

const toMs = (samples: number) => Math.round((samples / SAMPLE_RATE) * 1000);

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const cleanText = (text: string) => text.trim();

const createVad = (runtime: SherpaRuntime, modelPath: string) =>
  new runtime.Vad(
    {
      numThreads: 1,
      sampleRate: SAMPLE_RATE,
      sileroVad: {
        maxSpeechDuration: MAX_UTTERANCE_SECONDS,
        minSilenceDuration: 0.3,
        minSpeechDuration: 0.25,
        model: modelPath,
        threshold: 0.5,
        windowSize: VAD_WINDOW,
      },
    },
    60,
  );

interface RealtimeSessionOptions {
  emit: (event: LocalAsrRealtimeEvent) => void;
  now: () => number;
  recognizer: SherpaRecognizer;
  recordPath?: string;
  runtime: SherpaRuntime;
  sessionId: string;
  vadModel: string;
}

/**
 * One live transcription session: VAD-segmented SenseVoice decoding, with
 * periodic partials for the utterance in progress. Events mirror the cloud
 * realtime ASR protocol (`transcript.partial` → `transcript.final`, same segmentId).
 */
export class RealtimeSession {
  private readonly decodeTimes: number[] = [];
  private readonly opts: RealtimeSessionOptions;
  private readonly recorder?: WavRecorder;
  private readonly vad: SherpaVad;
  private pending = new Float32Array(0);
  private rolling: { samples: Float32Array; start: number }[] = [];
  private totalSamples = 0;
  private decodeMs = 0;
  private finals = 0;
  private sequence = 0;
  private speechStart?: number;
  private lastPartialAt = 0;
  private lastPartialText = '';

  constructor(opts: RealtimeSessionOptions) {
    this.opts = opts;
    this.vad = createVad(opts.runtime, opts.vadModel);
    if (opts.recordPath) this.recorder = new WavRecorder(opts.recordPath);
  }

  get id() {
    return this.opts.sessionId;
  }

  emitReady(loadMs: number) {
    this.emit({ engine: ENGINE_NAME, loadMs, type: 'session.ready' });
  }

  pushAudio(pcm: Uint8Array) {
    this.recorder?.write(pcm);
    const incoming = pcm16ToFloat32(pcm);
    this.remember(incoming);

    const merged = new Float32Array(this.pending.length + incoming.length);
    merged.set(this.pending);
    merged.set(incoming, this.pending.length);

    let offset = 0;
    for (; offset + VAD_WINDOW <= merged.length; offset += VAD_WINDOW) {
      this.vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW));
      this.drainFinals();
    }
    this.pending = merged.slice(offset);
    this.totalSamples += incoming.length;
    this.maybeEmitPartial();
  }

  async stop(): Promise<{ audioPath?: string; stats: LocalAsrSessionStats }> {
    if (this.pending.length > 0) {
      const tail = new Float32Array(VAD_WINDOW);
      tail.set(this.pending);
      this.vad.acceptWaveform(tail);
      this.pending = new Float32Array(0);
    }
    this.vad.flush();
    this.drainFinals();
    await this.recorder?.close();

    const stats = this.stats();
    this.emit({
      audioPath: this.opts.recordPath,
      forwardedAudioMs: stats.audioMs,
      stats,
      type: 'session.completed',
    });
    return { audioPath: this.opts.recordPath, stats };
  }

  async cancel() {
    await this.recorder?.close();
  }

  private stats(): LocalAsrSessionStats {
    const audioMs = toMs(this.totalSamples);
    return {
      audioMs,
      decodeMaxMs: Math.round(Math.max(0, ...this.decodeTimes)),
      decodeP50Ms: Math.round(median(this.decodeTimes)),
      rtf: audioMs ? Number((this.decodeMs / audioMs).toFixed(4)) : 0,
      segments: this.finals,
    };
  }

  private decode(samples: Float32Array) {
    const startedAt = this.opts.now();
    const stream = this.opts.recognizer.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    this.opts.recognizer.decode(stream);
    const text = cleanText(this.opts.recognizer.getResult(stream).text);
    const elapsed = this.opts.now() - startedAt;
    this.decodeMs += elapsed;
    return { elapsed, text };
  }

  private drainFinals() {
    while (!this.vad.isEmpty()) {
      // `false`: Electron's V8 memory cage rejects external buffers from the addon.
      const segment = this.vad.front(false);
      this.vad.pop();
      const { elapsed, text } = this.decode(segment.samples);
      this.decodeTimes.push(elapsed);
      this.speechStart = undefined;
      this.lastPartialText = '';
      if (!text) continue;
      this.emit({
        endMs: toMs(segment.start + segment.samples.length),
        segmentId: `seg-${this.finals + 1}`,
        startMs: toMs(segment.start),
        text,
        type: 'transcript.final',
      });
      this.finals += 1;
    }
  }

  private maybeEmitPartial() {
    if (!this.vad.isDetected()) {
      this.speechStart = undefined;
      return;
    }
    if (this.speechStart === undefined) {
      this.speechStart = Math.max(0, this.totalSamples - SPEECH_PREROLL_SAMPLES);
      this.lastPartialAt = this.totalSamples;
      return;
    }
    const length = this.totalSamples - this.speechStart;
    if (length < MIN_PARTIAL_SAMPLES) return;
    if (this.totalSamples - this.lastPartialAt < PARTIAL_INTERVAL_SAMPLES) return;
    this.lastPartialAt = this.totalSamples;

    const { text } = this.decode(this.slice(this.speechStart, this.totalSamples));
    if (!text || text === this.lastPartialText) return;
    this.lastPartialText = text;
    this.emit({
      endMs: toMs(this.totalSamples),
      segmentId: `seg-${this.finals + 1}`,
      startMs: toMs(this.speechStart),
      text,
      type: 'transcript.partial',
    });
  }

  private remember(samples: Float32Array) {
    this.rolling.push({ samples, start: this.totalSamples });
    const keepFrom = this.totalSamples + samples.length - ROLLING_SAMPLES;
    while (
      this.rolling.length > 0 &&
      this.rolling[0].start + this.rolling[0].samples.length < keepFrom
    ) {
      this.rolling.shift();
    }
  }

  private slice(from: number, to: number) {
    const out = new Float32Array(Math.max(0, to - from));
    for (const chunk of this.rolling) {
      const chunkEnd = chunk.start + chunk.samples.length;
      if (chunkEnd <= from || chunk.start >= to) continue;
      const begin = Math.max(from, chunk.start);
      const end = Math.min(to, chunkEnd);
      out.set(chunk.samples.subarray(begin - chunk.start, end - chunk.start), begin - from);
    }
    return out;
  }

  private emit(event: Record<string, unknown> & { type: LocalAsrRealtimeEvent['type'] }) {
    this.sequence += 1;
    this.opts.emit({
      ...event,
      sequence: this.sequence,
      sessionId: this.opts.sessionId,
    } as LocalAsrRealtimeEvent);
  }
}

interface EngineOptions {
  emitEvent: (event: LocalAsrRealtimeEvent) => void;
  emitProgress: (payload: LocalAsrJobProgressPayload) => void;
  now?: () => number;
  peakRssMb?: () => number;
  runtime: SherpaRuntime;
}

export interface StartSessionInput {
  language: LocalAsrLanguage;
  models: AsrModelPaths;
  recordPath?: string;
  sessionId: string;
}

export interface TranscribeFileInput {
  diarization?: DiarizationModelPaths;
  filePath: string;
  jobId: string;
  language: LocalAsrLanguage;
  models: AsrModelPaths;
}

/** Owns the loaded recognizer(s) and all sessions inside the engine process. */
export class LocalAsrEngine {
  private readonly opts: EngineOptions;
  private readonly now: () => number;
  private readonly recognizers = new Map<string, SherpaRecognizer>();
  private readonly sessions = new Map<string, RealtimeSession>();

  constructor(opts: EngineOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
  }

  startSession(input: StartSessionInput) {
    if (this.sessions.has(input.sessionId)) throw new Error('session_exists');
    const { loadMs, recognizer } = this.getRecognizer(input.models, input.language);
    const session = new RealtimeSession({
      emit: this.opts.emitEvent,
      now: this.now,
      recognizer,
      recordPath: input.recordPath,
      runtime: this.opts.runtime,
      sessionId: input.sessionId,
      vadModel: input.models.vad,
    });
    this.sessions.set(input.sessionId, session);
    session.emitReady(loadMs);
    return { loadMs };
  }

  pushAudio(sessionId: string, frame: Uint8Array) {
    this.sessions.get(sessionId)?.pushAudio(frame);
  }

  async stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('session_not_found');
    this.sessions.delete(sessionId);
    return session.stop();
  }

  async cancelSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    await session?.cancel();
  }

  async transcribeFile(input: TranscribeFileInput): Promise<LocalAsrTranscribeFileResult> {
    const startedAt = this.now();
    const progress = (phase: LocalAsrJobProgressPayload['phase'], value: number) =>
      this.opts.emitProgress({ jobId: input.jobId, phase, progress: value });

    progress('loading', 0);
    const { loadMs, recognizer } = this.getRecognizer(input.models, input.language);
    const samples = this.readMono16k(input.filePath);
    const audioMs = toMs(samples.length);

    const asrStartedAt = this.now();
    const vad = createVad(this.opts.runtime, input.models.vad);
    const pieces: Omit<LocalAsrTranscriptSegment, 'speaker'>[] = [];
    const drain = () => {
      while (!vad.isEmpty()) {
        const segment = vad.front(false);
        vad.pop();
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: segment.samples });
        recognizer.decode(stream);
        const text = cleanText(recognizer.getResult(stream).text);
        if (!text) continue;
        pieces.push({
          endMs: toMs(segment.start + segment.samples.length),
          id: `seg-${pieces.length + 1}`,
          startMs: toMs(segment.start),
          text,
        });
      }
    };

    let lastReported = 0;
    for (let offset = 0; offset + VAD_WINDOW <= samples.length; offset += VAD_WINDOW) {
      vad.acceptWaveform(samples.subarray(offset, offset + VAD_WINDOW));
      drain();
      const ratio = offset / samples.length;
      if (ratio - lastReported >= 0.05) {
        lastReported = ratio;
        progress('transcribing', Number(ratio.toFixed(2)));
      }
    }
    vad.flush();
    drain();
    progress('transcribing', 1);
    const asrMs = this.now() - asrStartedAt;

    let diarizationMs: number | undefined;
    let result: Pick<LocalAsrTranscribeFileResult, 'segments' | 'speakers'> = {
      segments: pieces,
      speakers: [],
    };
    if (input.diarization) {
      progress('diarization', 0);
      const diarizationStartedAt = this.now();
      const diarizer = new this.opts.runtime.OfflineSpeakerDiarization({
        clustering: { numClusters: -1, threshold: DIARIZATION_THRESHOLD },
        embedding: { model: input.diarization.embedding, numThreads: NUM_THREADS },
        minDurationOff: 0.5,
        minDurationOn: 0.3,
        segmentation: {
          numThreads: NUM_THREADS,
          pyannote: { model: input.diarization.segmentation },
        },
      });
      const turns = diarizer.process(samples);
      diarizationMs = this.now() - diarizationStartedAt;
      progress('merging', 1);
      result = assignSpeakers(pieces, turns);
    }

    const totalMs = this.now() - startedAt;
    return {
      audioMs,
      segments: result.segments,
      speakers: result.speakers,
      stats: {
        asrMs: Math.round(asrMs),
        diarizationMs: diarizationMs === undefined ? undefined : Math.round(diarizationMs),
        engine: input.diarization ? `${ENGINE_NAME} + pyannote-seg-3.0 / CAM++` : ENGINE_NAME,
        loadMs: Math.round(loadMs),
        peakRssMb: this.opts.peakRssMb?.() ?? 0,
        rtf: audioMs ? Number(((asrMs + (diarizationMs ?? 0)) / audioMs).toFixed(4)) : 0,
        totalMs: Math.round(totalMs),
      },
    };
  }

  async dispose() {
    for (const id of this.sessions.keys()) await this.cancelSession(id);
    this.recognizers.clear();
  }

  private getRecognizer(models: AsrModelPaths, language: LocalAsrLanguage) {
    const key = `${models.model}|${language}`;
    const cached = this.recognizers.get(key);
    if (cached) return { loadMs: 0, recognizer: cached };

    const startedAt = this.now();
    const recognizer = new this.opts.runtime.OfflineRecognizer({
      featConfig: { featureDim: 80, sampleRate: SAMPLE_RATE },
      modelConfig: {
        numThreads: NUM_THREADS,
        provider: 'cpu',
        senseVoice: { language, model: models.model, useInverseTextNormalization: 1 },
        tokens: models.tokens,
      },
    });
    // One recognizer per language is enough; drop others to bound memory.
    this.recognizers.clear();
    this.recognizers.set(key, recognizer);
    return { loadMs: this.now() - startedAt, recognizer };
  }

  private readMono16k(filePath: string) {
    const wave = this.opts.runtime.readWave(filePath, false);
    if (wave.sampleRate === SAMPLE_RATE) return wave.samples;
    return new this.opts.runtime.LinearResampler(wave.sampleRate, SAMPLE_RATE).flush(wave.samples);
  }
}
