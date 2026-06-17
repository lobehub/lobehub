import type { GenerateContentConfig, GoogleGenAI, Part } from '@google/genai';
import { createPartFromUri, FileState } from '@google/genai';
import Debug from 'debug';

import type { ASROptions, ASRPayload, ASRResponse } from '../../types';

const debug = Debug('lobe-model-runtime:google:transcribe');

const DEFAULT_PROMPT =
  'Transcribe the speech in this audio verbatim. Output only the transcript text — no commentary, labels, speaker tags, or timestamps.';

// Gemini caps an inline request at ~20MB total. base64 inflates bytes by ~4/3,
// so anything above ~14MB raw must go through the Files API instead of inline.
// @see https://ai.google.dev/gemini-api/docs/audio
const INLINE_MAX_BYTES = 14 * 1024 * 1024;

// Bound the wait for the Files API to finish processing an uploaded audio.
const FILE_PROCESS_TIMEOUT_MS = 60_000;
const FILE_POLL_INTERVAL_MS = 1_000;

// Audio mime types accepted by the Gemini API.
// @see https://ai.google.dev/gemini-api/docs/audio#supported-formats
const EXT_TO_MIME: Record<string, string> = {
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mp3',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

const guessMimeFromName = (fileName?: string): string | undefined => {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return ext ? EXT_TO_MIME[ext] : undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload audio via the Gemini Files API and wait until it is processed, then
 * reference it by URI. Used for payloads too large for an inline request.
 */
const uploadAudioFile = async (
  client: GoogleGenAI,
  file: Blob,
  mimeType: string,
  options?: ASROptions,
): Promise<Part> => {
  debug('audio exceeds inline limit, uploading via Files API');
  let uploaded = await client.files.upload({ config: { mimeType }, file });

  const deadline = Date.now() + FILE_PROCESS_TIMEOUT_MS;
  while (uploaded.state === FileState.PROCESSING) {
    if (options?.signal?.aborted) throw new Error('Request was cancelled');
    if (Date.now() > deadline) throw new Error('Gemini file processing timed out');
    await sleep(FILE_POLL_INTERVAL_MS);
    uploaded = await client.files.get({ name: uploaded.name! });
  }

  if (uploaded.state === FileState.FAILED || !uploaded.uri) {
    throw new Error(`Gemini file processing failed (state: ${uploaded.state})`);
  }

  debug('Files API upload ready: %s', uploaded.uri);
  return createPartFromUri(uploaded.uri, uploaded.mimeType ?? mimeType);
};

/**
 * Transcribe audio with Gemini's native multimodal `generateContent` API.
 *
 * Unlike the OpenAI-compatible `audio/transcriptions` endpoint, Gemini has no
 * dedicated speech endpoint — audio is passed alongside a text prompt and the
 * model returns the transcript as plain text. Small files are sent inline;
 * larger ones go through the Files API.
 *
 * @see https://ai.google.dev/gemini-api/docs/audio
 */
export const createGoogleTranscription = async (
  client: GoogleGenAI,
  payload: ASRPayload,
  options?: ASROptions,
): Promise<ASRResponse> => {
  const { file, fileName, model, language, prompt } = payload;

  const mimeType = file.type || guessMimeFromName(fileName ?? (file as File).name) || 'audio/mp3';

  const audioPart: Part =
    file.size <= INLINE_MAX_BYTES
      ? {
          inlineData: {
            data: Buffer.from(await file.arrayBuffer()).toString('base64'),
            mimeType,
          },
        }
      : await uploadAudioFile(client, file, mimeType, options);

  const instruction = [
    prompt || DEFAULT_PROMPT,
    language ? `The spoken language is "${language}".` : '',
  ]
    .filter(Boolean)
    .join(' ');

  debug('transcribe via gemini model %s, audio %d bytes, mime %s', model, file.size, mimeType);

  const config: GenerateContentConfig = {
    abortSignal: options?.signal,
  };

  const response = await client.models.generateContent({
    config,
    contents: [{ parts: [audioPart, { text: instruction }], role: 'user' }],
    model,
  });

  const text = (response.text ?? '').trim();
  debug('transcription completed, text length %d', text.length);

  return { text };
};
