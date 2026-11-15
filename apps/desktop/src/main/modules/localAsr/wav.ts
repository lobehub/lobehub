import { createWriteStream, type WriteStream } from 'node:fs';
import { open } from 'node:fs/promises';

export const SAMPLE_RATE = 16_000;
const HEADER_BYTES = 44;

export const createWavHeader = (dataBytes: number, sampleRate = SAMPLE_RATE) => {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
};

/** Streams 16 kHz mono pcm_s16le to a WAV file and patches the header on close. */
export class WavRecorder {
  private readonly stream: WriteStream;
  private dataBytes = 0;

  constructor(readonly filePath: string) {
    this.stream = createWriteStream(filePath);
    this.stream.write(createWavHeader(0));
  }

  write(pcm: Uint8Array) {
    this.dataBytes += pcm.byteLength;
    this.stream.write(pcm);
  }

  async close() {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    const handle = await open(this.filePath, 'r+');
    try {
      await handle.write(createWavHeader(this.dataBytes), 0, HEADER_BYTES, 0);
    } finally {
      await handle.close();
    }
  }
}

export const pcm16ToFloat32 = (pcm: Uint8Array) => {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = view.getInt16(i * 2, true) / 32_768;
  return samples;
};
