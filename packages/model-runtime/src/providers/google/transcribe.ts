import type { GenerateContentConfig, GoogleGenAI } from '@google/genai';
import Debug from 'debug';

import type { ASROptions, ASRPayload, ASRResponse } from '../../types';

const debug = Debug('lobe-model-runtime:google:transcribe');

const DEFAULT_PROMPT =
  'Transcribe the speech in this audio verbatim. Output only the transcript text — no commentary, labels, speaker tags, or timestamps.';

// Audio mime types accepted by the Gemini inline-data API.
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

/**
 * Transcribe audio with Gemini's native multimodal `generateContent` API.
 *
 * Unlike the OpenAI-compatible `audio/transcriptions` endpoint, Gemini has no
 * dedicated speech endpoint — audio is passed inline alongside a text prompt and
 * the model returns the transcript as plain text.
 *
 * @see https://ai.google.dev/gemini-api/docs/audio
 */
export const createGoogleTranscription = async (
  client: GoogleGenAI,
  payload: ASRPayload,
  options?: ASROptions,
): Promise<ASRResponse> => {
  const { file, fileName, model, language, prompt } = payload;

  const arrayBuffer = await file.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = file.type || guessMimeFromName(fileName ?? (file as File).name) || 'audio/mp3';

  const instruction = [
    prompt || DEFAULT_PROMPT,
    language ? `The spoken language is "${language}".` : '',
  ]
    .filter(Boolean)
    .join(' ');

  debug(
    'transcribe via gemini model %s, audio %d bytes, mime %s',
    model,
    arrayBuffer.byteLength,
    mimeType,
  );

  const config: GenerateContentConfig = {
    abortSignal: options?.signal,
  };

  const response = await client.models.generateContent({
    config,
    contents: [
      {
        parts: [{ inlineData: { data, mimeType } }, { text: instruction }],
        role: 'user',
      },
    ],
    model,
  });

  const text = (response.text ?? '').trim();
  debug('transcription completed, text length %d', text.length);

  return { text };
};
