import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';

const asrProcedure = wsCompatProcedure.use(serverDatabase);

// Inline base64 is only for short clips. The whole request must fit inside the
// platform body limit (≈4.5MB on serverless deploys) and base64 inflates bytes
// by ~4/3, so cap the decoded audio well under that — anything larger should be
// uploaded and passed as `fileId`.
const MAX_INLINE_AUDIO_BYTES = 3 * 1024 * 1024;
// base64 length ≈ ceil(bytes / 3) * 4; validating the string length lets us
// reject oversized payloads before allocating/decoding them.
const MAX_INLINE_AUDIO_BASE64_CHARS = Math.ceil(MAX_INLINE_AUDIO_BYTES / 3) * 4;

interface ResolvedAudio {
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string;
}

export const asrRouter = router({
  /**
   * Automatic Speech Recognition (speech-to-text).
   *
   * Accepts the audio either as an already-uploaded `fileId` (preferred — the
   * server streams the bytes from storage, nothing large travels over tRPC) or
   * inline as base64 for short clips (capped at `MAX_INLINE_AUDIO_BYTES`;
   * larger payloads are rejected with guidance to upload and pass `fileId`).
   *
   * Note on base64: tRPC here uses an `httpLink` + superjson (JSON only), which
   * has no binary representation for a `Buffer`/`Uint8Array` — a raw buffer would
   * serialize to a per-byte JSON object, far worse than base64. So inline bytes
   * stay base64; use `fileId` to avoid inlining entirely.
   *
   * Transcription is a single request/response (not streamed), so a mutation is
   * the right shape.
   */
  transcribe: asrProcedure
    .input(
      z
        .object({
          /** Base64-encoded audio bytes (short clips only). Mutually exclusive with `fileId`. */
          audioBase64: z
            .string()
            .min(1)
            .max(MAX_INLINE_AUDIO_BASE64_CHARS, {
              message: `Inline audio is limited to ${MAX_INLINE_AUDIO_BYTES / 1024 / 1024}MB. Upload the file and pass \`fileId\` instead.`,
            })
            .optional(),
          /** Already-uploaded audio file id. Mutually exclusive with `audioBase64`. */
          fileId: z.string().min(1).optional(),
          /** Original file name (base64 path); its extension helps format detection. */
          fileName: z.string().optional(),
          /** ISO-639-1 language code (e.g. `en`, `zh`). */
          language: z.string().optional(),
          /** Audio mime type (base64 path, e.g. `audio/mp4`). */
          mimeType: z.string().optional(),
          model: z.string().min(1),
          /** Optional text to guide the model's style. */
          prompt: z.string().optional(),
          provider: z.string().default('openai'),
          responseFormat: z.enum(['json', 'srt', 'text', 'verbose_json', 'vtt']).optional(),
        })
        .refine((d) => Boolean(d.fileId) !== Boolean(d.audioBase64), {
          message: 'Provide exactly one of `fileId` or `audioBase64`.',
        }),
    )
    .mutation(async ({ ctx, input }): Promise<{ text: string }> => {
      const workspaceId = ctx.workspaceId ?? undefined;

      const { bytes, fileName, mimeType } = await resolveAudio(ctx, input, workspaceId);

      // Resolve the user's provider config (key + baseURL) from the database,
      // falling back to server env keys, exactly like chat/embeddings do.
      const runtime = await initModelRuntimeFromDB(
        ctx.serverDB,
        ctx.userId,
        input.provider,
        workspaceId,
      );

      // `Uint8Array` is a valid BlobPart at runtime; the cast sidesteps the
      // `Uint8Array<ArrayBufferLike>` vs BlobPart generic mismatch in lib.dom.
      const file = new File([bytes as BlobPart], fileName, {
        type: mimeType || 'application/octet-stream',
      });

      const result = await runtime.transcribe(
        {
          file,
          fileName,
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

/**
 * Turn the request into raw audio bytes + metadata, from either a stored file
 * (downloaded from S3, ownership enforced by the userId-scoped FileModel) or the
 * inline base64 payload.
 */
async function resolveAudio(
  ctx: { serverDB: LobeChatDatabase; userId: string },
  input: { audioBase64?: string; fileId?: string; fileName?: string; mimeType?: string },
  workspaceId?: string,
): Promise<ResolvedAudio> {
  if (input.fileId) {
    const fileModel = new FileModel(ctx.serverDB, ctx.userId, workspaceId);
    const fileItem = await fileModel.findById(input.fileId);

    if (!fileItem) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `File "${input.fileId}" not found.` });
    }

    const fileService = new FileService(ctx.serverDB, ctx.userId, workspaceId);
    let bytes: Uint8Array;
    try {
      bytes = await fileService.getFileByteArray(fileItem.url);
    } catch (error) {
      if ((error as { Code?: string }).Code === 'NoSuchKey') {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `File "${input.fileId}" is no longer available in storage.`,
        });
      }
      throw error;
    }

    return { bytes, fileName: fileItem.name, mimeType: fileItem.fileType };
  }

  return {
    bytes: new Uint8Array(Buffer.from(input.audioBase64!, 'base64')),
    fileName: input.fileName || 'audio',
    mimeType: input.mimeType,
  };
}

export type AsrRouter = typeof asrRouter;
