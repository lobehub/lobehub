import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { sunoClient } from '@/business/server/audio-generation/suno';
import { AudioGenerationModel } from '@/database/models/audioGeneration';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { audioPollingService } from '@/server/services/audio/polling';

const audioProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      audioGenerationModel: new AudioGenerationModel(ctx.serverDB, ctx.userId),
    },
  });
});

// Validation schemas
const musicStyleEnum = z.enum([
  'pop',
  'rock',
  'jazz',
  'lo-fi',
  'classical',
  'ambient',
  'hip-hop',
]);

const generateAudioInput = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(1000, 'Prompt is too long'),
  musicStyle: musicStyleEnum,
  duration: z.number().min(15, 'Duration minimum is 15 seconds').max(120, 'Duration maximum is 120 seconds'),
});

const getAudioStatusInput = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
});

const getAudioDetailsInput = z.object({
  audioId: z.string().uuid('Invalid audio ID'),
});

const deleteAudioInput = z.object({
  audioId: z.string().uuid('Invalid audio ID'),
});

const listAudioHistoryInput = z.object({
  page: z.number().int().min(1, 'Page must be at least 1').default(1),
  pageSize: z.number().int().min(1, 'Page size must be at least 1').max(50, 'Page size maximum is 50').default(10),
});

export const audioRouter = router({
  /**
   * Generate audio from prompt
   */
  generateAudio: audioProcedure
    .input(generateAudioInput)
    .mutation(async ({ ctx, input }) => {
      try {
        // Call Suno API to generate music
        const taskId = await sunoClient.generateMusic({
          prompt: input.prompt,
          style: input.musicStyle,
          duration: input.duration,
          model: 'v5.5',
        });

        // Save to database
        const audioGeneration = await ctx.audioGenerationModel.create({
          prompt: input.prompt,
          musicStyle: input.musicStyle,
          duration: input.duration,
          modelVersion: 'v5.5',
          taskId,
          status: 'pending',
        });

        return {
          audioId: audioGeneration.id,
          taskId,
          status: 'pending',
          createdAt: audioGeneration.createdAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate audio';
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message,
        });
      }
    }),

  /**
   * Get audio generation status
   */
  getAudioStatus: audioProcedure
    .input(getAudioStatusInput)
    .query(async ({ ctx, input }) => {
      try {
        // Find audio record by task ID
        const audioRecord = await ctx.audioGenerationModel.findByTaskId(input.taskId);

        if (!audioRecord) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Audio generation not found',
          });
        }

        // If already completed or failed, return cached data
        if (audioRecord.status === 'completed' || audioRecord.status === 'failed') {
          return {
            taskId: input.taskId,
            audioId: audioRecord.id,
            status: audioRecord.status,
            audioUrl: audioRecord.audioUrl,
            progress: audioRecord.status === 'completed' ? 100 : 0,
            metadata: audioRecord.audioMetadata,
            error: audioRecord.error,
          };
        }

        // Poll current status from Suno API
        const task = await audioPollingService.pollTaskStatus(input.taskId);

        // Update database with latest status
        if (task.status !== audioRecord.status) {
          await ctx.audioGenerationModel.update(audioRecord.id, {
            status: task.status,
            audioUrl: task.audio_url,
            audioMetadata: {
              title: task.title,
              duration: task.duration,
              imageLargeUrl: task.image_large_url,
              imageUrl: task.image_url,
              lyricUrl: task.lyric_url,
            },
            error: task.error,
          });
        }

        return {
          taskId: input.taskId,
          audioId: audioRecord.id,
          status: task.status,
          audioUrl: task.audio_url,
          progress: task.status === 'completed' ? 100 : (task.status === 'processing' ? 50 : 25),
          metadata: {
            title: task.title,
            duration: task.duration,
            imageLargeUrl: task.image_large_url,
            imageUrl: task.image_url,
            lyricUrl: task.lyric_url,
          },
          error: task.error,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : 'Failed to get audio status';
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message,
        });
      }
    }),

  /**
   * Get audio generation details
   */
  getAudioDetails: audioProcedure
    .input(getAudioDetailsInput)
    .query(async ({ ctx, input }) => {
      const audioRecord = await ctx.audioGenerationModel.findById(input.audioId);

      if (!audioRecord) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Audio generation not found',
        });
      }

      return {
        id: audioRecord.id,
        taskId: audioRecord.taskId,
        prompt: audioRecord.prompt,
        musicStyle: audioRecord.musicStyle,
        duration: audioRecord.duration,
        modelVersion: audioRecord.modelVersion,
        status: audioRecord.status,
        audioUrl: audioRecord.audioUrl,
        metadata: audioRecord.audioMetadata,
        createdAt: audioRecord.createdAt,
        updatedAt: audioRecord.updatedAt,
      };
    }),

  /**
   * Delete audio generation
   */
  deleteAudio: audioProcedure
    .input(deleteAudioInput)
    .mutation(async ({ ctx, input }) => {
      const audioRecord = await ctx.audioGenerationModel.findById(input.audioId);

      if (!audioRecord) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Audio generation not found',
        });
      }

      await ctx.audioGenerationModel.delete(input.audioId);

      return { success: true };
    }),

  /**
   * List user's audio generation history
   */
  listAudioHistory: audioProcedure
    .input(listAudioHistoryInput)
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;

      const { data, total } = await ctx.audioGenerationModel.listByUser(
        input.pageSize,
        offset,
      );

      return {
        items: data.map((audio) => ({
          id: audio.id,
          taskId: audio.taskId,
          prompt: audio.prompt,
          musicStyle: audio.musicStyle,
          duration: audio.duration,
          status: audio.status,
          audioUrl: audio.audioUrl,
          metadata: audio.audioMetadata,
          createdAt: audio.createdAt,
          updatedAt: audio.updatedAt,
        })),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize),
        },
      };
    }),
});

export type AudioRouter = typeof audioRouter;
