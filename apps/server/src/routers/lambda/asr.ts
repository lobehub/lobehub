import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const asrProcedure = wsCompatProcedure.use(serverDatabase);

export const asrRouter = router({
  /**
   * Automatic Speech Recognition (speech-to-text).
   *
   * Audio bytes are sent base64-encoded in the JSON body. This is a single
   * request/response call (transcription is not streamed), so a tRPC mutation
   * is the right shape — there is no SSE/stream to preserve.
   */
  transcribe: asrProcedure
    .input(
      z.object({
        /** Base64-encoded audio bytes. */
        audioBase64: z.string().min(1),
        /** Original file name; its extension helps the provider detect the format. */
        fileName: z.string().optional(),
        /** ISO-639-1 language code (e.g. `en`, `zh`). */
        language: z.string().optional(),
        /** Audio mime type (e.g. `audio/mp4`). */
        mimeType: z.string().optional(),
        model: z.string().min(1),
        /** Optional text to guide the model's style. */
        prompt: z.string().optional(),
        provider: z.string().default('openai'),
        responseFormat: z.enum(['json', 'srt', 'text', 'verbose_json', 'vtt']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ text: string }> => {
      // Resolve the user's provider config (key + baseURL) from the database,
      // falling back to server env keys, exactly like chat/embeddings do.
      const runtime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        input.provider,
        ctx.workspaceId ?? undefined,
      );

      const bytes = Buffer.from(input.audioBase64, 'base64');
      const file = new File([bytes], input.fileName || 'audio', {
        type: input.mimeType || 'application/octet-stream',
      });

      const result = await runtime.transcribe(
        {
          file,
          fileName: input.fileName,
          language: input.language,
          model: input.model,
          prompt: input.prompt,
          responseFormat: input.responseFormat,
        },
        { user: ctx.userId },
      );

      if (!result) {
        throw new TRPCError({
          code: 'NOT_IMPLEMENTED',
          message: `Provider "${input.provider}" does not support ASR.`,
        });
      }

      return result;
    }),
});

export type AsrRouter = typeof asrRouter;
