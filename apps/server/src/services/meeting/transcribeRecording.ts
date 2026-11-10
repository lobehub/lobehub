import type { ASRKnownSpeaker, ASRPayload, ASRResponse, ASRSegment } from '@lobechat/model-runtime';

import { MeetingTranscriptionError } from './errors';
import type { AudioChunk, PcmAudio } from './wav';
import { encodePcmWav, frameCount, parsePcmWav, planChunks, toWavDataUrl } from './wav';

/** One refined utterance, offsets in ms from the start of the recording. */
export interface RefinedSegment {
  endMs: number;
  /** `S1`, `S2`, … numbered by first appearance across the whole meeting. */
  speakerLabel?: string;
  startMs: number;
  text: string;
}

export type TranscribeFn = (payload: Omit<ASRPayload, 'model'>) => Promise<ASRResponse | undefined>;

export interface TranscribeRecordingInput {
  bytes: Uint8Array;
  fileName: string;
  /** ISO-639-1 code; omit to let the provider detect it. */
  language?: string;
  /** Longest piece sent per request. Defaults to 10 min (≈19 MB of 16 kHz WAV). */
  maxChunkMs?: number;
  mimeType?: string;
  /** Model that will run, used to pick a response format that carries timing and speakers. */
  model: string;
  /** Called after each chunk with `(done, total)`. */
  onProgress?: (done: number, total: number) => void;
  transcribe: TranscribeFn;
}

export const DEFAULT_MAX_CHUNK_MS = 10 * 60_000;
/** Providers that accept one upload cap it near 25 MB; stay under it for whole-file requests. */
const MAX_WHOLE_FILE_BYTES = 24 * 1024 * 1024;
const MAX_KNOWN_SPEAKERS = 4;
const MIN_REFERENCE_MS = 2000;
const MAX_REFERENCE_MS = 8000;
const PARALLEL_CHUNKS = 3;

const isDiarizingModel = (model: string) => /diariz/i.test(model);

const responseFormatFor = (model: string): ASRPayload['responseFormat'] => {
  if (isDiarizingModel(model)) return 'diarized_json';
  if (/^whisper/i.test(model)) return 'verbose_json';
  return 'json';
};

interface ChunkResult {
  chunk: AudioChunk;
  response: ASRResponse;
}

/** Run `task` over `items` with at most `limit` in flight, keeping input order. */
const mapWithLimit = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/**
 * Pick one clean sample per speaker of the first chunk, so later chunks label
 * the same voices with the same names instead of restarting at `A`.
 */
const pickKnownSpeakers = (
  audio: PcmAudio,
  { chunk, response }: ChunkResult,
  labelOf: (providerLabel: string) => string,
): ASRKnownSpeaker[] => {
  const longest = new Map<string, ASRSegment>();
  for (const segment of response.segments ?? []) {
    if (!segment.speaker) continue;
    const current = longest.get(segment.speaker);
    if (!current || segment.end - segment.start > current.end - current.start) {
      longest.set(segment.speaker, segment);
    }
  }

  const framesPerSecond = audio.sampleRate;
  const speakers: ASRKnownSpeaker[] = [];
  for (const [providerLabel, segment] of longest) {
    if (speakers.length >= MAX_KNOWN_SPEAKERS) break;
    // Trim the edges, where a neighbour's voice or the cut itself may bleed in.
    const startS = segment.start + 0.25;
    const endS = Math.min(segment.end - 0.25, startS + MAX_REFERENCE_MS / 1000);
    if ((endS - startS) * 1000 < MIN_REFERENCE_MS) continue;

    speakers.push({
      name: labelOf(providerLabel),
      reference: toWavDataUrl(audio, {
        end: Math.min(chunk.end, chunk.start + Math.floor(endS * framesPerSecond)),
        start: chunk.start + Math.floor(startS * framesPerSecond),
      }),
    });
  }
  return speakers;
};

const toSegments = (
  { chunk, response }: ChunkResult,
  sampleRate: number,
  labelOf: (providerLabel: string) => string,
): RefinedSegment[] => {
  const offsetMs = (chunk.start / sampleRate) * 1000;
  const chunkEndMs = (chunk.end / sampleRate) * 1000;

  if (!response.segments?.length) {
    const text = response.text.trim();
    return text ? [{ endMs: Math.round(chunkEndMs), startMs: Math.round(offsetMs), text }] : [];
  }

  return response.segments.flatMap((segment) => {
    const text = segment.text.trim();
    if (!text) return [];
    const startMs = Math.round(Math.min(offsetMs + segment.start * 1000, chunkEndMs));
    const endMs = Math.round(
      Math.min(Math.max(offsetMs + segment.end * 1000, startMs), chunkEndMs),
    );
    return [
      {
        endMs,
        ...(segment.speaker ? { speakerLabel: labelOf(segment.speaker) } : {}),
        startMs,
        text,
      },
    ];
  });
};

/**
 * Transcribe a whole recording into timed, speaker-labelled segments.
 *
 * PCM WAV is cut into chunks at pauses and sent as separate requests: the
 * first chunk alone, then the rest in parallel with voice samples from the
 * first chunk so speaker names stay stable across chunks. Other formats go in
 * one request. Any failed request fails the whole pass — a partial transcript
 * would silently drop speech.
 */
export const transcribeRecording = async ({
  bytes,
  fileName,
  language,
  maxChunkMs = DEFAULT_MAX_CHUNK_MS,
  mimeType,
  model,
  onProgress,
  transcribe,
}: TranscribeRecordingInput): Promise<RefinedSegment[]> => {
  if (bytes.byteLength === 0) throw new MeetingTranscriptionError('audio_missing');

  const responseFormat = responseFormatFor(model);
  const diarize = responseFormat === 'diarized_json';
  const request = async (file: Uint8Array, name: string, type: string, extra = {}) => {
    const response = await transcribe({
      ...(diarize ? { chunkingStrategy: 'auto' as const } : {}),
      file: new File([file as BlobPart], name, { type }),
      fileName: name,
      language,
      responseFormat,
      ...extra,
    });
    if (!response) {
      throw new MeetingTranscriptionError(
        'provider_not_configured',
        'The provider does not support speech-to-text',
      );
    }
    return response;
  };

  // Speaker labels as the user sees them, numbered by first appearance.
  let speakerCount = 0;
  const nextLabel = () => `S${++speakerCount}`;

  const audio = parsePcmWav(bytes);
  if (!audio) {
    if (bytes.byteLength > MAX_WHOLE_FILE_BYTES) {
      throw new MeetingTranscriptionError(
        'audio_unsupported',
        'Recordings over 24 MB must be 16-bit PCM WAV to be split',
      );
    }
    const response = await request(bytes, fileName, mimeType || 'application/octet-stream');
    onProgress?.(1, 1);
    const labels = new Map<string, string>();
    const labelOf = (label: string) =>
      labels.get(label) ?? labels.set(label, nextLabel()).get(label)!;
    // Without decodable PCM the chunk spans the reported duration, or is open-ended.
    const end = Math.round((response.duration ?? 0) * 1000) || Number.MAX_SAFE_INTEGER;
    return toSegments({ chunk: { end, start: 0 }, response }, 1000, labelOf);
  }

  if (frameCount(audio) === 0) throw new MeetingTranscriptionError('audio_missing');

  const chunks = planChunks(audio, { maxChunkMs });
  const sendChunk = (chunk: AudioChunk, index: number, extra = {}) =>
    request(encodePcmWav(audio, chunk), `chunk-${index}.wav`, 'audio/wav', extra);

  let done = 0;
  const report = () => onProgress?.(++done, chunks.length);

  const first: ChunkResult = { chunk: chunks[0], response: await sendChunk(chunks[0], 0) };
  report();

  const firstLabels = new Map<string, string>();
  const firstLabelOf = (label: string) =>
    firstLabels.get(label) ?? firstLabels.set(label, nextLabel()).get(label)!;
  // Assign labels in order of appearance before picking references.
  for (const segment of first.response.segments ?? []) {
    if (segment.speaker) firstLabelOf(segment.speaker);
  }
  const knownSpeakers =
    diarize && chunks.length > 1 ? pickKnownSpeakers(audio, first, firstLabelOf) : [];
  const knownNames = new Set(knownSpeakers.map((speaker) => speaker.name));

  const rest = await mapWithLimit(chunks.slice(1), PARALLEL_CHUNKS, async (chunk, index) => {
    const response = await sendChunk(
      chunk,
      index + 1,
      knownSpeakers.length > 0 ? { knownSpeakers } : {},
    );
    report();
    return { chunk, response } satisfies ChunkResult;
  });

  const segments = toSegments(first, audio.sampleRate, firstLabelOf);
  for (const result of rest) {
    // Known names carry over; any other label is a voice new to this chunk.
    const labels = new Map<string, string>();
    const labelOf = (label: string) => {
      if (knownNames.has(label)) return label;
      return labels.get(label) ?? labels.set(label, nextLabel()).get(label)!;
    };
    segments.push(...toSegments(result, audio.sampleRate, labelOf));
  }

  return segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
};
