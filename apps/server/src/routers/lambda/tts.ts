import type { ModelUsage } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { TTSAudioFormat } from 'model-bank';
import { z } from 'zod';

import {
  requireWorkspaceRoleWhenScoped,
  wsCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  INLINE_TTS_AUDIO_FORMATS,
  TTSProviderError,
  TTSRequestError,
  TTSService,
} from '@/server/services/tts';

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
      const service = new TTSService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

      try {
        const result = await service.synthesize(input);

        return {
          audioBase64: Buffer.from(result.audio).toString('base64'),
          format: result.format,
          mimeType: result.mimeType,
          usage: result.usage,
        };
      } catch (error) {
        if (error instanceof TTSRequestError) {
          throw new TRPCError({
            code: error.reason === 'invalid_params' ? 'BAD_REQUEST' : 'NOT_IMPLEMENTED',
            message: error.message,
          });
        }
        if (error instanceof TTSProviderError) {
          throw new TRPCError({
            cause: error.detail,
            code: error.errorType === 'RateLimitExceeded' ? 'TOO_MANY_REQUESTS' : 'BAD_GATEWAY',
            message: error.message,
          });
        }
        throw error;
      }
    },
  ),
});
