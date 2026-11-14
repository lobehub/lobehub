// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createWavHeader,
  decodeGeminiAudio,
  encodeMp3,
  encodeWav,
  GEMINI_DEFAULT_SAMPLE_RATE,
  parseWav,
  type PcmAudio,
  SpeechAudioError,
} from './speechAudio';

/** `frames` of a 440 Hz sine as 16-bit LE mono PCM. */
const sinePcm = (frames: number, sampleRate = 24_000) => {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
  return data;
};

const pcmAudio = (data: Buffer, overrides: Partial<PcmAudio> = {}): PcmAudio => ({
  bitsPerSample: 16,
  channels: 1,
  data,
  sampleRate: 24_000,
  ...overrides,
});

/** An MP3 stream starts with an ID3 tag or an MPEG frame sync (11 set bits). */
const looksLikeMp3 = (buffer: Buffer) =>
  buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);

describe('decodeGeminiAudio', () => {
  it('reads the sample rate from an audio/L16 mime type', () => {
    const pcm = sinePcm(240);
    const audio = decodeGeminiAudio(pcm.toString('base64'), 'audio/L16;codec=pcm;rate=16000');

    expect(audio).toMatchObject({ bitsPerSample: 16, channels: 1, sampleRate: 16_000 });
    expect(audio.data.equals(pcm)).toBe(true);
  });

  it('accepts spaces, case and a channels parameter', () => {
    const audio = decodeGeminiAudio(
      sinePcm(4).toString('base64'),
      'audio/l16; rate=48000; channels=2',
    );

    expect(audio).toMatchObject({ channels: 2, sampleRate: 48_000 });
  });

  it('falls back to 24 kHz mono when the mime type has no rate', () => {
    const audio = decodeGeminiAudio(sinePcm(4).toString('base64'), 'audio/pcm');

    expect(audio).toMatchObject({ channels: 1, sampleRate: GEMINI_DEFAULT_SAMPLE_RATE });
  });

  it('unwraps WAV output (the Gemini 3.8 default) by mime type or RIFF magic', () => {
    const pcm = sinePcm(100);
    const wav = encodeWav(pcmAudio(pcm, { sampleRate: 16_000 }));

    for (const mimeType of ['audio/wav', 'application/octet-stream', '']) {
      const audio =
        mimeType === 'application/octet-stream'
          ? parseWav(wav)
          : decodeGeminiAudio(wav.toString('base64'), mimeType);
      expect(audio).toMatchObject({ bitsPerSample: 16, channels: 1, sampleRate: 16_000 });
      expect(audio.data.equals(pcm)).toBe(true);
    }
  });

  it('rejects non-16-bit PCM, unknown audio types and empty audio', () => {
    expect(() => decodeGeminiAudio('AAAA', 'audio/L24;rate=24000')).toThrow(/24-bit/);
    expect(() => decodeGeminiAudio('AAAA', 'audio/ogg')).toThrow(SpeechAudioError);
    expect(() => decodeGeminiAudio('', 'audio/L16;rate=24000')).toThrow(/empty audio/);
  });
});

describe('parseWav', () => {
  it('skips extra chunks and clamps a streaming (oversized) data length', () => {
    const pcm = sinePcm(10);
    const header = createWavHeader({
      bitsPerSample: 16,
      channels: 1,
      dataLength: 0,
      sampleRate: 24_000,
    });
    header.writeUInt32LE(0xff_ff_ff_ff, 40); // unknown length, as a streaming writer leaves it
    // Insert an odd-sized LIST chunk (with its pad byte) between fmt and data.
    const list = Buffer.concat([
      Buffer.from('LIST'),
      Buffer.from([3, 0, 0, 0]),
      Buffer.from('abc\0'),
    ]);
    const wav = Buffer.concat([header.subarray(0, 36), list, header.subarray(36), pcm]);

    const audio = parseWav(wav);
    expect(audio.data.equals(pcm)).toBe(true);
  });

  it('reads a zero data length (streaming writer) to the end of the file', () => {
    const pcm = sinePcm(10);
    const wav = encodeWav(pcmAudio(pcm));
    wav.writeUInt32LE(0, 40);

    expect(parseWav(wav).data.equals(pcm)).toBe(true);
  });

  it('rejects non-PCM and malformed files', () => {
    const wav = encodeWav(pcmAudio(sinePcm(4)));
    const float = Buffer.from(wav);
    float.writeUInt16LE(3, 20); // IEEE float

    expect(() => parseWav(float)).toThrow(/unsupported WAV encoding 3/);
    expect(() => parseWav(Buffer.from('not a wav file'))).toThrow(/invalid WAV/);
    expect(() => parseWav(wav.subarray(0, 36))).toThrow(/without audio data/);
  });
});

describe('encodeWav', () => {
  it('writes a canonical 44-byte header for the PCM', () => {
    const pcm = sinePcm(24_000);
    const wav = encodeWav(pcmAudio(pcm));

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.readUInt32LE(28)).toBe(48_000); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });
});

describe('encodeMp3', () => {
  it('encodes 24 kHz mono PCM into a much smaller MP3 stream', async () => {
    const pcm = sinePcm(24_000); // 1 second = 48,000 bytes
    const mp3 = await encodeMp3(pcmAudio(pcm));

    expect(looksLikeMp3(mp3)).toBe(true);
    // 40 kbps for one second is ~5 KB; allow encoder padding frames.
    expect(mp3.length).toBeGreaterThan(3000);
    expect(mp3.length).toBeLessThan(9000);
  });

  it('yields to the event loop while encoding long audio', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    try {
      await encodeMp3(pcmAudio(sinePcm(24_000 * 5)));
    } finally {
      clearInterval(timer);
    }

    expect(ticks).toBeGreaterThan(0);
  });

  it('encodes interleaved stereo PCM', async () => {
    const mono = sinePcm(4800);
    const stereo = Buffer.alloc(mono.length * 2);
    for (let i = 0; i < mono.length / 2; i++) {
      stereo.writeInt16LE(mono.readInt16LE(i * 2), i * 4);
      stereo.writeInt16LE(mono.readInt16LE(i * 2), i * 4 + 2);
    }

    const mp3 = await encodeMp3(pcmAudio(stereo, { channels: 2 }));
    expect(looksLikeMp3(mp3)).toBe(true);
  });

  it('rejects sample rates and layouts MP3 cannot carry', async () => {
    await expect(encodeMp3(pcmAudio(sinePcm(4), { sampleRate: 96_000 }))).rejects.toThrow(
      /96000 Hz/,
    );
    await expect(encodeMp3(pcmAudio(sinePcm(4), { channels: 6 }))).rejects.toThrow(/6-channel/);
  });
});
