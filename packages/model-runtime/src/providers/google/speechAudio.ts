/**
 * Audio helpers for Gemini speech generation. Gemini returns 16-bit linear PCM, either
 * headerless (`audio/L16;codec=pcm;rate=24000`) or wrapped in a RIFF/WAV container
 * (`audio/wav`, the Gemini 3.8 TTS default), so the runtime decodes both into raw PCM
 * and re-encodes it into the format the caller asked for.
 */

/** Gemini TTS output when the mime type carries no rate (24 kHz, mono, 16-bit). */
export const GEMINI_DEFAULT_SAMPLE_RATE = 24_000;

/**
 * Bitrate of the MP3 encoding. A full 16,384-token output (about 11 minutes) is about 3.3 MB
 * (4.4 MB as base64), inside the ~4.5 MB inline response limit; the raw PCM would be ~31 MB.
 * Below 40 kbps LAME resamples 24 kHz input first, which is ~8x slower in pure JS.
 */
export const GEMINI_MP3_KBPS = 40;

/** Sample rates the LAME MP3 encoder accepts (MPEG-1, MPEG-2 and MPEG-2.5). */
const MP3_SAMPLE_RATES = new Set([
  8000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000,
]);

/** Samples per MP3 frame for MPEG-2 / 2.5 Layer III; multiples keep the encoder's buffers small. */
const MP3_FRAME_SAMPLES = 1152;

/**
 * Frames encoded between yields to the event loop: about one second of 24 kHz audio, ~12 ms
 * of CPU, so a long synthesis never stalls other requests on the same server.
 */
const MP3_FRAMES_PER_YIELD = 21;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface PcmAudio {
  bitsPerSample: number;
  channels: number;
  /** Little-endian signed PCM samples, channels interleaved. */
  data: Buffer;
  sampleRate: number;
}

export class SpeechAudioError extends Error {}

const parseMimeParams = (mimeType: string) => {
  const [type, ...rest] = mimeType.split(';').map((part) => part.trim());
  const params: Record<string, string> = {};

  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }

  return { params, type: (type ?? '').toLowerCase() };
};

const parsePositiveInt = (value: string | undefined): number | undefined => {
  if (!value) return;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const isRiff = (data: Buffer) =>
  data.length >= 12 &&
  data.toString('ascii', 0, 4) === 'RIFF' &&
  data.toString('ascii', 8, 12) === 'WAVE';

/**
 * Read the `fmt ` and `data` chunks of a RIFF/WAV buffer. Only integer PCM is accepted;
 * a streaming writer may leave the data size as 0 or 0xFFFFFFFF, so the chunk is clamped
 * to the bytes actually present.
 */
export const parseWav = (data: Buffer): PcmAudio => {
  if (!isRiff(data)) throw new SpeechAudioError('Gemini returned an invalid WAV file');

  let offset = 12;
  let format: Omit<PcmAudio, 'data'> | undefined;

  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      const audioFormat = data.readUInt16LE(body);
      // 1 = integer PCM, 0xFFFE = WAVE_FORMAT_EXTENSIBLE (PCM sub-format for 16-bit output)
      if (audioFormat !== 1 && audioFormat !== 0xff_fe) {
        throw new SpeechAudioError(`Gemini returned unsupported WAV encoding ${audioFormat}`);
      }
      format = {
        bitsPerSample: data.readUInt16LE(body + 14),
        channels: data.readUInt16LE(body + 2),
        sampleRate: data.readUInt32LE(body + 4),
      };
    } else if (id === 'data') {
      if (!format) throw new SpeechAudioError('Gemini returned a WAV file without a fmt chunk');
      // A streaming writer leaves the size as 0 or 0xFFFFFFFF; then the data runs to the end.
      const end = size === 0 ? data.length : Math.min(data.length, body + size);
      return { ...format, data: data.subarray(body, end) };
    }

    // Chunks are word-aligned: an odd-sized chunk is followed by one pad byte.
    offset = body + size + (size % 2);
  }

  throw new SpeechAudioError('Gemini returned a WAV file without audio data');
};

/**
 * Decode one Gemini `inlineData` audio part into PCM. `audio/L16` / `audio/pcm` carry the
 * rate (and optionally channels) as mime parameters; WAV is detected by mime type or by its
 * RIFF magic, since some gateways relabel the payload.
 */
export const decodeGeminiAudio = (base64: string, mimeType = ''): PcmAudio => {
  const data = Buffer.from(base64, 'base64');
  if (data.length === 0) throw new SpeechAudioError('Gemini returned empty audio');

  const { params, type } = parseMimeParams(mimeType);

  if (isRiff(data) || type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') {
    return parseWav(data);
  }

  const bitsMatch = /^audio\/l(\d+)$/.exec(type);
  if (!bitsMatch && type !== 'audio/pcm' && type !== '') {
    throw new SpeechAudioError(`Gemini returned unsupported audio type "${mimeType}"`);
  }

  const bitsPerSample = bitsMatch ? Number(bitsMatch[1]) : 16;
  if (bitsPerSample !== 16) {
    throw new SpeechAudioError(`Gemini returned unsupported ${bitsPerSample}-bit PCM audio`);
  }

  return {
    bitsPerSample,
    channels: parsePositiveInt(params.channels) ?? 1,
    data,
    sampleRate: parsePositiveInt(params.rate) ?? GEMINI_DEFAULT_SAMPLE_RATE,
  };
};

/** 44-byte canonical RIFF/WAV header for little-endian integer PCM. */
export const createWavHeader = ({
  bitsPerSample,
  channels,
  dataLength,
  sampleRate,
}: Omit<PcmAudio, 'data'> & { dataLength: number }): Buffer => {
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // integer PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  return header;
};

export const encodeWav = (pcm: PcmAudio): Buffer =>
  Buffer.concat([createWavHeader({ ...pcm, dataLength: pcm.data.length }), pcm.data]);

/** Copy 16-bit LE PCM into aligned Int16Arrays, one per channel (at most stereo). */
const splitChannels = (pcm: PcmAudio): Int16Array[] => {
  const frameCount = Math.floor(pcm.data.length / (2 * pcm.channels));
  const channels = Array.from({ length: pcm.channels }, () => new Int16Array(frameCount));

  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < pcm.channels; channel++) {
      channels[channel][frame] = pcm.data.readInt16LE((frame * pcm.channels + channel) * 2);
    }
  }

  return channels;
};

/**
 * Encode 16-bit PCM to MP3 with the pure-JS LAME port, so the audio fits the inline
 * response of every caller and plays everywhere. The encoder is loaded on first use.
 */
export const encodeMp3 = async (pcm: PcmAudio): Promise<Buffer> => {
  if (pcm.bitsPerSample !== 16) {
    throw new SpeechAudioError(`Cannot encode ${pcm.bitsPerSample}-bit PCM to MP3`);
  }
  if (pcm.channels < 1 || pcm.channels > 2) {
    throw new SpeechAudioError(`Cannot encode ${pcm.channels}-channel audio to MP3`);
  }
  if (!MP3_SAMPLE_RATES.has(pcm.sampleRate)) {
    throw new SpeechAudioError(`Cannot encode ${pcm.sampleRate} Hz audio to MP3`);
  }

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(pcm.channels, pcm.sampleRate, GEMINI_MP3_KBPS);
  const [left, right] = splitChannels(pcm);
  const chunks: Buffer[] = [];
  // The encoder hands back Int8Array views despite its typings; copy-free wrap as bytes.
  const push = (chunk: ArrayBufferView) => {
    if (chunk.byteLength > 0)
      chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  };

  for (let frame = 0, start = 0; start < left.length; frame++, start += MP3_FRAME_SAMPLES) {
    if (frame > 0 && frame % MP3_FRAMES_PER_YIELD === 0) await yieldToEventLoop();

    const end = start + MP3_FRAME_SAMPLES;
    push(encoder.encodeBuffer(left.subarray(start, end), right?.subarray(start, end)));
  }
  push(encoder.flush());

  return Buffer.concat(chunks);
};

export const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
