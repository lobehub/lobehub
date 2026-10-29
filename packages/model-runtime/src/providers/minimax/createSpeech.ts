import createDebug from 'debug';

import type { CreateSpeechOptions } from '../../core/openaiCompatibleFactory';
import type { TextToSpeechOptions, TextToSpeechPayload } from '../../types/tts';
import { resolveMappedModelId } from '../../utils/modelIdMapping';

const log = createDebug('lobe-tts:minimax');

const DEFAULT_MINIMAX_SPEECH_ROOT = 'https://api.minimaxi.com';
const MINIMAX_SPEECH_PATH = '/v1/t2a_v2';
/**
 * Strip the API surface suffix (`/v1`, `/anthropic`, `/anthropic/v1/messages`)
 * from the configured base URL so only the regional root is kept. MiniMax
 * serves text-to-audio from the same regional host as chat, so deriving the
 * endpoint from the base URL keeps every regional deployment working without
 * extra configuration.
 */
const MINIMAX_API_SUFFIX_PATTERN = /\/(?:anthropic(?:\/v1\/messages)?|v1)\/?$/;

export const resolveMiniMaxSpeechEndpoint = (baseURL?: string | null) => {
  const root = (baseURL || DEFAULT_MINIMAX_SPEECH_ROOT)
    .replace(MINIMAX_API_SUFFIX_PATTERN, '')
    .replace(/\/$/, '');

  return `${root}${MINIMAX_SPEECH_PATH}`;
};

/** Audio containers the speech endpoint can encode the synthesized audio into. */
export const MINIMAX_AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'pcm'] as const;

type MiniMaxAudioFormat = (typeof MINIMAX_AUDIO_FORMATS)[number];

const DEFAULT_AUDIO_FORMAT: MiniMaxAudioFormat = 'mp3';

/**
 * The shared TTS payload only declares the fields every provider needs; the
 * OpenAI-compatible request fields callers may add are forwarded as-is, so read
 * them defensively instead of widening the shared type.
 */
type MiniMaxSpeechPayload = TextToSpeechPayload & {
  audio_setting?: Record<string, unknown> & { format?: string };
  language_boost?: string;
  pronunciation_dict?: Record<string, unknown>;
  response_format?: string;
  speed?: number;
  subtitle_enable?: boolean;
  voice_modify?: Record<string, unknown>;
  voice_setting?: Record<string, unknown>;
};

interface MiniMaxSpeechResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  data?: {
    /** Hex-encoded audio, in the container requested via `audio_setting.format`. */
    audio?: string;
    /** `1` while synthesizing, `2` once synthesis completed. */
    status?: number;
  };
}

const isSupportedAudioFormat = (format?: string): format is MiniMaxAudioFormat =>
  !!format && (MINIMAX_AUDIO_FORMATS as readonly string[]).includes(format);

const HEX_PATTERN = /^[\da-f]+$/i;

const hexToArrayBuffer = (hex: string) => {
  const normalized = hex.trim();

  if (normalized.length === 0 || normalized.length % 2 !== 0 || !HEX_PATTERN.test(normalized)) {
    throw new Error('MiniMax returned a malformed hex audio payload');
  }

  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes.buffer;
};

/**
 * Synthesize speech using the MiniMax text-to-audio API.
 *
 * The response carries the audio inline as hex, so the buffer is decoded here
 * and returned directly instead of going through a temporary download URL.
 */
export async function createMiniMaxSpeech(
  payload: TextToSpeechPayload,
  options: CreateSpeechOptions,
  requestOptions?: TextToSpeechOptions,
): Promise<ArrayBuffer> {
  const { apiKey, baseURL } = options;
  const {
    audio_setting,
    input,
    language_boost,
    pronunciation_dict,
    response_format,
    speed,
    subtitle_enable,
    voice,
    voice_modify,
    voice_setting,
  } = payload as MiniMaxSpeechPayload;
  const model = resolveMappedModelId(payload.model, options);
  const endpoint = resolveMiniMaxSpeechEndpoint(baseURL);

  const requestedFormat = response_format || audio_setting?.format;
  const format = isSupportedAudioFormat(requestedFormat) ? requestedFormat : DEFAULT_AUDIO_FORMAT;
  const voiceSetting = {
    ...voice_setting,
    ...(voice ? { voice_id: voice } : {}),
    ...(typeof speed === 'number' ? { speed } : {}),
  };

  const requestBody: Record<string, unknown> = {
    audio_setting: { ...audio_setting, format },
    ...(language_boost !== undefined ? { language_boost } : {}),
    model,
    // Hex is the only non-streaming output that keeps the audio in the response
    // body; a URL would expire and require a second round-trip.
    output_format: 'hex',
    ...(pronunciation_dict !== undefined ? { pronunciation_dict } : {}),
    stream: false,
    ...(subtitle_enable !== undefined ? { subtitle_enable } : {}),
    text: input,
    ...(Object.keys(voiceSetting).length > 0 ? { voice_setting: voiceSetting } : {}),
    ...(voice_modify !== undefined ? { voice_modify } : {}),
  };

  log('Text to audio request: endpoint=%s model=%s format=%s', endpoint, model, format);

  const response = await fetch(endpoint, {
    body: JSON.stringify(requestBody),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...requestOptions?.headers,
    },
    method: 'POST',
    signal: requestOptions?.signal,
  });

  if (!response.ok) {
    let errorText: string | undefined;
    try {
      errorText = await response.text();
    } catch {
      // Failed to read the error response body
    }

    throw new Error(`MiniMax API error (${response.status}): ${errorText || response.statusText}`);
  }

  const data: MiniMaxSpeechResponse = await response.json();

  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax API error: ${data.base_resp.status_msg}`);
  }

  if (data.data?.status !== undefined && data.data.status !== 2) {
    throw new Error(`MiniMax text to audio response is not complete (status ${data.data.status})`);
  }

  const audio = data.data?.audio;

  if (!audio) {
    throw new Error('No audio data in text to audio response');
  }

  const buffer = hexToArrayBuffer(audio);

  log('Text to audio completed: %d bytes, status=%o', buffer.byteLength, data.data?.status);

  return buffer;
}
