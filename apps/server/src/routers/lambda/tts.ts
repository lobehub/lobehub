import type { ModelUsage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { AITTSModelCard, TTSAudioFormat } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST, TTS_AUDIO_MIME_TYPES, validateTTSParams } from 'model-bank';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

/**
 * The audio returns inline as base64 inside one buffered response (≈4.5MB on serverless
 * deploys). Uncompressed `wav` / `pcm` (and lossless `flac`) outgrow that within about a
 * minute of speech, after the provider has already billed the synthesis, so this transport
 * only offers compressed formats.
 */
const INLINE_TTS_AUDIO_FORMATS = ['mp3', 'opus', 'aac'] as const;

const ttsParamsInput = z
  .object({
    emotion: z.string().min(1).optional(),
    format: z
      .enum(INLINE_TTS_AUDIO_FORMATS, {
        message: `params.format must be one of ${INLINE_TTS_AUDIO_FORMATS.join(', ')} for inline audio`,
      })
      .optional(),
    instructions: z.string().optional(),
    pitch: z.number().optional(),
    sampleRate: z.number().int().positive().optional(),
    speed: z.number().positive().optional(),
    volume: z.number().optional(),
  })
  .strict();

const synthesizeInput = z.object({
  input: z.string().min(1),
  model: z.string().min(1),
  /** Standard TTS params, checked against the model card when it declares them. */
  params: ttsParamsInput.optional(),
  provider: z.string().min(1).default('openai'),
  /** @deprecated Use `params.speed`. */
  speed: z.number().min(0.25).max(4).optional(),
  /** Defaults to the model card's default voice. */
  voice: z.string().min(1).optional(),
});

const ttsProcedure = wsCompatProcedure
  .use(serverDatabase)
  .use(requireWorkspaceRoleWhenScoped('member'));

/**
 * Built-in card of a TTS model: the provider's own card first, then any provider
 * serving the same model id (aggregators reuse upstream cards).
 */
const findTTSModelCard = (provider: string, model: string): AITTSModelCard | undefined => {
  const cards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.type === 'tts' && card.id === model);

  return (cards.find((card) => card.providerId === provider) ?? cards[0]) as
    AITTSModelCard | undefined;
};

export const ttsRouter = router({
  synthesize: ttsProcedure.input(synthesizeInput).mutation(
    async ({
      ctx,
      input,
    }): Promise<{
      audioBase64: string;
      format: TTSAudioFormat;
      mimeType: string;
      usage?: ModelUsage;
    }> => {
      const { input: text, model, provider } = input;
      const card = findTTSModelCard(provider, model);
      const params = { ...input.params };
      // Older CLIs always send the deprecated top-level `speed`; drop it for models that
      // declare no speed instead of failing validation they never opted into.
      const acceptsLegacySpeed = !card?.parameters || 'speed' in card.parameters;
      if (params.speed === undefined && input.speed !== undefined && acceptsLegacySpeed) {
        params.speed = input.speed;
      }

      if (card?.parameters) {
        const issues = validateTTSParams(card.parameters, params);
        if (issues.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: issues.map(({ key, reason }) => `params.${key} ${reason}`).join('; '),
          });
        }
      }

      const voice = input.voice ?? card?.parameters?.voice?.default ?? 'alloy';

      const runtime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        provider,
        ctx.workspaceId ?? undefined,
      );

      const result = await runtime.textToSpeech(
        { input: text, model, params, voice },
        { metadata: { trigger: RequestTrigger.Tts }, user: ctx.userId },
      );

      if (!result) {
        throw new TRPCError({
          code: 'NOT_IMPLEMENTED',
          message: `Provider "${provider}" does not support text-to-speech.`,
        });
      }

      return {
        audioBase64: Buffer.from(result.audio).toString('base64'),
        format: result.format,
        mimeType: TTS_AUDIO_MIME_TYPES[result.format],
        usage: result.usage,
      };
    },
  ),
});
