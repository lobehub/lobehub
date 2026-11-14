/**
 * Minimal PCM WAV handling for meeting recordings.
 *
 * The recorder uploads 16-bit PCM WAV, which is what lets the refine pass cut
 * an hour-long recording into provider-sized pieces without a decoder. Any
 * other container is passed to the provider whole (see `MeetingRefineService`).
 */

export interface PcmAudio {
  channels: number;
  sampleRate: number;
  /** Interleaved 16-bit samples. */
  samples: Int16Array;
}

/** A `[startSample, endSample)` slice of mono-equivalent sample frames. */
export interface AudioChunk {
  end: number;
  start: number;
}

const readTag = (view: DataView, offset: number) =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

/** Parse a RIFF/WAVE file holding 16-bit PCM; returns `undefined` for anything else. */
export const parsePcmWav = (bytes: Uint8Array): PcmAudio | undefined => {
  if (bytes.byteLength < 44) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readTag(view, 0) !== 'RIFF' || readTag(view, 8) !== 'WAVE') return undefined;

  let format: { bitsPerSample: number; channels: number; formatTag: number; sampleRate: number };
  let offset = 12;
  let fmtFound = false;

  while (offset + 8 <= bytes.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && size >= 16) {
      format = {
        bitsPerSample: view.getUint16(body + 14, true),
        channels: view.getUint16(body + 2, true),
        formatTag: view.getUint16(body, true),
        sampleRate: view.getUint32(body + 4, true),
      };
      fmtFound = true;
    } else if (id === 'data' && fmtFound) {
      // 1 = PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (PCM sub-format in practice).
      if (
        (format!.formatTag !== 1 && format!.formatTag !== 0xff_fe) ||
        format!.bitsPerSample !== 16 ||
        format!.channels < 1 ||
        format!.sampleRate <= 0
      ) {
        return undefined;
      }

      // A recorder that crashed before patching the header leaves size 0 or
      // 0xFFFFFFFF; trust the bytes that are actually there.
      const available = bytes.byteLength - body;
      const dataBytes = size === 0 || size > available ? available : size;
      const sampleCount = Math.floor(dataBytes / 2);
      const samples = new Int16Array(sampleCount);
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = view.getInt16(body + index * 2, true);
      }
      return { channels: format!.channels, sampleRate: format!.sampleRate, samples };
    }

    offset = body + size + (size % 2);
  }

  return undefined;
};

/** Number of sample frames (one sample per channel) in the audio. */
export const frameCount = (audio: PcmAudio) => Math.floor(audio.samples.length / audio.channels);

export const durationMs = (audio: PcmAudio) =>
  Math.round((frameCount(audio) / audio.sampleRate) * 1000);

/** Encode a slice of the audio as a standalone 16-bit PCM WAV file. */
export const encodePcmWav = (audio: PcmAudio, chunk?: AudioChunk): Uint8Array => {
  const start = (chunk?.start ?? 0) * audio.channels;
  const end = (chunk?.end ?? frameCount(audio)) * audio.channels;
  const samples = audio.samples.subarray(start, end);
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, tag.charCodeAt(index));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audio.channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * audio.channels * 2, true);
  view.setUint16(32, audio.channels * 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index], true);
  }

  return new Uint8Array(buffer);
};

/** Mean energy of the frames in `[start, end)`, all channels pooled. */
const energy = (audio: PcmAudio, start: number, end: number) => {
  let sum = 0;
  const from = start * audio.channels;
  const to = Math.min(end * audio.channels, audio.samples.length);
  for (let index = from; index < to; index += 1) sum += audio.samples[index] ** 2;
  return to > from ? sum / (to - from) : 0;
};

export interface PlanChunksOptions {
  /** Longest chunk to send in one request. */
  maxChunkMs: number;
  /** How far before a hard cut to look for a pause. */
  searchWindowMs?: number;
  /** Length of the quiet span a cut is centered on. */
  silenceWindowMs?: number;
}

/**
 * Split the audio into chunks of at most `maxChunkMs`, cutting at the quietest
 * point of the last `searchWindowMs` before each limit so a cut rarely lands
 * mid-word. Chunks are contiguous and cover every frame exactly once.
 */
export const planChunks = (
  audio: PcmAudio,
  { maxChunkMs, searchWindowMs = 30_000, silenceWindowMs = 400 }: PlanChunksOptions,
): AudioChunk[] => {
  const total = frameCount(audio);
  const framesPerMs = audio.sampleRate / 1000;
  const maxFrames = Math.max(1, Math.floor(maxChunkMs * framesPerMs));
  const searchFrames = Math.min(Math.floor(searchWindowMs * framesPerMs), maxFrames - 1);
  const window = Math.max(1, Math.floor(silenceWindowMs * framesPerMs));
  const hop = Math.max(1, Math.floor(window / 4));

  const chunks: AudioChunk[] = [];
  let start = 0;
  while (start < total) {
    const hardEnd = start + maxFrames;
    if (hardEnd >= total) {
      chunks.push({ end: total, start });
      break;
    }

    let bestCut = hardEnd;
    let bestEnergy = Number.POSITIVE_INFINITY;
    for (let from = hardEnd - searchFrames; from + window <= hardEnd; from += hop) {
      const value = energy(audio, from, from + window);
      if (value < bestEnergy) {
        bestEnergy = value;
        bestCut = from + Math.floor(window / 2);
      }
    }

    chunks.push({ end: bestCut, start });
    start = bestCut;
  }

  return chunks;
};

/** `data:audio/wav;base64,…` for a slice of the audio, as provider speaker references expect. */
export const toWavDataUrl = (audio: PcmAudio, chunk: AudioChunk) =>
  `data:audio/wav;base64,${Buffer.from(encodePcmWav(audio, chunk)).toString('base64')}`;
