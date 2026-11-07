import { z } from 'zod';

/** Formats an OpenAI client may ask for; only the compressed ones are served inline. */
export const OPENAI_SPEECH_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const;

/** LobeHub's standard TTS params, checked against the model card before synthesis. */
export const SpeechParamsSchema = z
  .object({
    emotion: z.string().min(1).optional(),
    pitch: z.number().optional(),
    sampleRate: z.number().int().positive().optional(),
    volume: z.number().optional(),
  })
  .strict();

/**
 * Body of `POST /api/v1/audio/speech`: OpenAI's `audio.speech.create` request, plus the
 * optional LobeHub `provider` and `params` extensions.
 */
export const SpeechRequestSchema = z.object({
  /**
   * OpenAI caps one request at 4096 characters. Keeping the same bound keeps a single
   * response well under the serverless body limit.
   */
  input: z.string().min(1).max(4096),
  instructions: z.string().optional(),
  /** `provider/model` (for example `lobehub/speech-2.8-hd`), or a bare model id. */
  model: z.string().min(1),
  params: SpeechParamsSchema.optional(),
  /** Explicit provider; wins over a `provider/` prefix in `model`. */
  provider: z.string().min(1).optional(),
  response_format: z.enum(OPENAI_SPEECH_FORMATS).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  stream_format: z.enum(['audio', 'sse']).optional(),
  /** A voice id, or OpenAI's `{ id }` form. Defaults to the model's default voice. */
  voice: z.union([z.string().min(1), z.object({ id: z.string().min(1) })]).optional(),
});

export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;
