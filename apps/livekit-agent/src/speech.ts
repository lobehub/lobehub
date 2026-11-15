import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { audioFramesFromFile } from '@livekit/agents';
import OpenAI from 'openai';

import type { LobeHubBridge } from './bridge.js';

/** Codec adapters only. Actual ASR/TTS uses the user's authenticated LobeHub providers. */
export const createSpeechClient = (bridge: LobeHubBridge) =>
  new OpenAI({
    apiKey: 'lobehub-browser-bridge',
    baseURL: 'https://speech.invalid/v1',
    maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith('/audio/transcriptions')) {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File)) throw new Error('Missing speech audio');
        const result = await bridge.requestSpeech(
          { kind: 'asr', audioBase64: Buffer.from(await file.arrayBuffer()).toString('base64') },
          request.signal,
        );
        return Response.json({ text: result.text ?? '' });
      }
      if (!new URL(request.url).pathname.endsWith('/audio/speech'))
        throw new Error('Unsupported speech operation');
      const body = (await request.json()) as { input: string };
      const result = await bridge.requestSpeech({ kind: 'tts', text: body.input }, request.signal);
      if (!result.audioBase64 || !result.format) throw new Error('Missing synthesized speech');
      const directory = await mkdtemp(join(tmpdir(), 'lobehub-speech-'));
      try {
        const path = join(directory, `speech.${result.format}`);
        await writeFile(path, Buffer.from(result.audioBase64, 'base64'));
        const chunks: Buffer[] = [];
        for await (const frame of audioFramesFromFile(path, {
          sampleRate: 24000,
          numChannels: 1,
        })) {
          request.signal.throwIfAborted();
          chunks.push(Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
        }
        return new Response(Buffer.concat(chunks), { headers: { 'content-type': 'audio/pcm' } });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });
