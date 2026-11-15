import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type APIConnectOptions,
  asLanguageCode,
  type AudioBuffer,
  audioFramesFromFile,
  mergeFrames,
  stt,
  tts,
} from '@livekit/agents';

import type { LobeHubBridge } from './bridge.js';

/** Native LiveKit provider extension; speech credentials stay in LobeHub. */
export class LobeHubSTT extends stt.STT {
  label = 'lobehub.STT';
  constructor(
    private readonly bridge: LobeHubBridge,
    private readonly language: string,
  ) {
    super({ streaming: false, interimResults: false });
  }
  async _recognize(buffer: AudioBuffer, signal?: AbortSignal): Promise<stt.SpeechEvent> {
    signal?.throwIfAborted();
    const frame = mergeFrames(buffer);
    const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    if (pcm.byteLength + 44 > 3 * 1024 * 1024)
      throw new Error('Speech segment exceeds the inline transcription limit');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(frame.channels, 22);
    header.writeUInt32LE(frame.sampleRate, 24);
    header.writeUInt32LE(frame.sampleRate * frame.channels * 2, 28);
    header.writeUInt16LE(frame.channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const result = await this.bridge.requestSpeech(
      { kind: 'asr', audioBase64: Buffer.concat([header, pcm]).toString('base64') },
      signal,
    );
    return {
      type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      requestId: result.requestId,
      alternatives: [
        {
          text: result.text ?? '',
          language: asLanguageCode(this.language),
          startTime: 0,
          endTime: frame.samplesPerChannel / frame.sampleRate,
          confidence: 1,
        },
      ],
    };
  }
  stream(): stt.SpeechStream {
    throw new Error('LobeHub STT uses LiveKit’s VAD stream adapter');
  }
}

export class LobeHubTTS extends tts.TTS {
  label = 'lobehub.TTS';
  constructor(readonly bridge: LobeHubBridge) {
    super(24000, 1, { streaming: false });
  }
  synthesize(text: string, options?: APIConnectOptions, signal?: AbortSignal): tts.ChunkedStream {
    return new LobeHubSpeechStream(text, this, options, signal);
  }
  stream(): tts.SynthesizeStream {
    throw new Error('LobeHub TTS uses LiveKit’s sentence stream adapter');
  }
}

class LobeHubSpeechStream extends tts.ChunkedStream {
  label = 'lobehub.ChunkedStream';
  constructor(
    text: string,
    private readonly provider: LobeHubTTS,
    options?: APIConnectOptions,
    signal?: AbortSignal,
  ) {
    super(text, provider, options, signal);
  }
  async run() {
    const directory = await mkdtemp(path.join(tmpdir(), 'lobehub-speech-'));
    try {
      // Sentence adapters normally bound text, but a long unpunctuated reply can exceed it.
      for (let offset = 0; offset < this.inputText.length; offset += 4000) {
        this.abortSignal.throwIfAborted();
        const result = await this.provider.bridge.requestSpeech(
          { kind: 'tts', text: this.inputText.slice(offset, offset + 4000) },
          this.abortSignal,
        );
        if (!result.audioBase64 || !result.format) throw new Error('Missing synthesized speech');
        const file = path.join(directory, `speech.${result.format}`);
        await writeFile(file, Buffer.from(result.audioBase64, 'base64'));
        const requestId = result.requestId || randomUUID();
        let previous: tts.SynthesizedAudio | undefined;
        for await (const frame of audioFramesFromFile(file, {
          sampleRate: 24000,
          numChannels: 1,
          abortSignal: this.abortSignal,
        })) {
          this.abortSignal.throwIfAborted();
          if (previous) this.queue.put(previous);
          previous = { requestId, segmentId: requestId, frame, final: false };
        }
        if (previous)
          this.queue.put({ ...previous, final: offset + 4000 >= this.inputText.length });
      }
    } finally {
      this.queue.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
