import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';

/**
 * Image / video generation on the public REST API.
 *
 * A generation is one output (one image, one video) of a generation request.
 * Requests are asynchronous: `POST /images/generations` and
 * `POST /videos/generations` queue the work and answer with the generation
 * ids; `GET /generations/{id}` reports the status and, once it succeeded, the
 * asset URLs. Each request becomes a batch inside a generation topic — the same
 * records the Image / Video pages in the app show.
 */

export const GENERATION_KINDS = ['image', 'video', 'music'] as const;
export const GENERATION_STATUSES = ['pending', 'processing', 'success', 'error'] as const;
/** Statuses after which a generation no longer changes. */
export const TERMINAL_GENERATION_STATUSES = ['success', 'error'] as const;

/** Extra model-specific parameters, checked against the model's declared parameters. */
const ExtraParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]))
  .describe(
    'Model-specific parameters beyond the named fields (for example `quality` or `size`). Parameters the model does not declare are rejected with 400.',
  );

const PromptSchema = z.string().trim().min(1).max(10_000).describe('What to generate.');
const TopicIdSchema = z
  .string()
  .min(1)
  .describe(
    'Generation topic to add this request to. Omit to start a new topic, as `lh generate` does.',
  );

export const CreateImageGenerationRequestSchema = z
  .object({
    cfg: z.number().optional().describe('Guidance scale, for models that accept one.'),
    height: z.number().int().positive().optional().describe('Image height in pixels.'),
    imageUrls: z
      .array(z.string().url())
      .max(10)
      .optional()
      .describe('Reference images (URLs) for image-to-image models.'),
    model: z
      .string()
      .min(1)
      .optional()
      .describe("Image model id. Omit to use the account's default image model."),
    n: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(1)
      .describe('Number of images to generate, 1–8. Defaults to 1.'),
    params: ExtraParamsSchema.optional(),
    prompt: PromptSchema,
    provider: z
      .string()
      .min(1)
      .optional()
      .describe('Provider id. Omit to use the first enabled provider serving `model`.'),
    seed: z.number().int().nullish().describe('Seed; omit for a random one per image.'),
    steps: z.number().int().positive().optional().describe('Sampling steps.'),
    topicId: TopicIdSchema.optional(),
    wait: z
      .boolean()
      .default(true)
      .describe(
        'Wait for the images before answering (up to `waitTimeoutSeconds`). Generations still running at the deadline come back with their current status; poll `GET /generations/{id}` for the rest. Set `false` to answer as soon as the work is queued.',
      ),
    waitTimeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(60)
      .describe('How long `wait` may hold the request, 1–120 seconds. Defaults to 60.'),
    width: z.number().int().positive().optional().describe('Image width in pixels.'),
  })
  .strict();

export const CreateVideoGenerationRequestSchema = z
  .object({
    aspectRatio: z.string().min(1).optional().describe('Aspect ratio, for example `16:9`.'),
    cameraFixed: z.boolean().optional().describe('Keep the camera still, where supported.'),
    duration: z.number().positive().optional().describe('Video length in seconds.'),
    endImageUrl: z.string().url().nullish().describe('Last frame (URL), where supported.'),
    generateAudio: z.boolean().optional().describe('Generate a soundtrack, where supported.'),
    imageUrl: z.string().url().nullish().describe('First frame (URL) for image-to-video.'),
    model: z.string().min(1).describe('Video model id.'),
    params: ExtraParamsSchema.optional(),
    previousGenerationId: z
      .string()
      .min(1)
      .optional()
      .describe('A video generation to edit, for models that support conversational editing.'),
    prompt: PromptSchema,
    provider: z.string().min(1).describe('Provider id serving `model`.'),
    resolution: z.string().min(1).optional().describe('Output resolution, for example `720p`.'),
    seed: z.number().int().nullish().describe('Seed; omit for a random one.'),
    topicId: TopicIdSchema.optional(),
  })
  .strict();

export const GenerationAssetSchema = z
  .object({
    coverUrl: z.string().nullable().describe('Video cover image URL.'),
    duration: z.number().nullable().describe('Video length in seconds.'),
    height: z.number().nullable(),
    thumbnailUrl: z.string().nullable().describe('Resized preview URL.'),
    url: z.string().nullable().describe('Full-size asset URL.'),
    width: z.number().nullable(),
  })
  .strict()
  .meta({ id: 'GenerationAsset' });

export const GenerationErrorSchema = z
  .object({
    message: z.string().describe('Human-readable failure reason.'),
    name: z.string().describe('Error type, for example `ServerError` or `Timeout`.'),
  })
  .strict()
  .meta({ id: 'GenerationError' });

export const GenerationSchema = z
  .object({
    asset: GenerationAssetSchema.nullable().describe('The output; `null` until it succeeded.'),
    batchId: z.string().describe('The request (batch) this generation belongs to.'),
    createdAt: z.string().describe('ISO 8601 timestamp.'),
    error: GenerationErrorSchema.nullable().describe('Why it failed; `null` unless `error`.'),
    fileId: z
      .string()
      .nullable()
      .describe('Library file the output was saved as, once it succeeded.'),
    id: z.string(),
    model: z.string(),
    prompt: z.string(),
    provider: z.string(),
    seed: z.number().nullable(),
    status: z
      .enum(GENERATION_STATUSES)
      .describe('`pending` → `processing` → `success` | `error`. The last two are final.'),
    topicId: z.string().describe('The generation topic the request was added to.'),
    type: z.enum(GENERATION_KINDS),
  })
  .strict()
  .meta({ id: 'Generation' });

export const GenerationBatchCreatedSchema = z
  .object({
    batchId: z.string(),
    generations: z.array(GenerationSchema),
    topicId: z.string(),
  })
  .strict();

export const GenerationListQuerySchema = CursorPaginationQuerySchema.extend({
  type: z.enum(GENERATION_KINDS).optional().describe('Only generations of this kind.'),
});

export const GenerationListResponseSchema = paginatedListSchema(GenerationSchema, { total: true });

export const GenerationIdParamSchema = z.object({ id: z.string().min(1) });

export type CreateImageGenerationRequest = z.infer<typeof CreateImageGenerationRequestSchema>;
export type CreateVideoGenerationRequest = z.infer<typeof CreateVideoGenerationRequestSchema>;
export type GenerationAssetPayload = z.infer<typeof GenerationAssetSchema>;
export type GenerationPayload = z.infer<typeof GenerationSchema>;
export type GenerationBatchCreated = z.infer<typeof GenerationBatchCreatedSchema>;
export type GenerationListQuery = z.infer<typeof GenerationListQuerySchema>;
export type GenerationIdParam = z.infer<typeof GenerationIdParamSchema>;

// ---------- transcription ----------

/**
 * Uploaded audio is handed to the transcription procedure inline, which caps a
 * clip at 3 MB; larger recordings are uploaded first and passed as `fileId`.
 */
export const MAX_TRANSCRIPTION_UPLOAD_BYTES = 3 * 1024 * 1024;

export const TRANSCRIPTION_FORMATS = ['json', 'text', 'srt', 'verbose_json', 'vtt'] as const;

/**
 * Form fields of `POST /audio/transcriptions` other than the file, OpenAI's
 * `audio.transcriptions.create` shape plus LobeHub's `provider` and `fileId`.
 */
export const TranscriptionFieldsSchema = z
  .object({
    fileId: z.string().min(1).optional(),
    language: z.string().min(2).max(16).optional(),
    model: z.string().min(1),
    prompt: z.string().max(4096).optional(),
    provider: z.string().min(1).optional(),
    response_format: z.enum(TRANSCRIPTION_FORMATS).optional(),
  })
  .strict();

export const TranscriptionSchema = z
  .object({ text: z.string().describe('The transcript.') })
  .strict()
  .meta({ id: 'Transcription' });

export type TranscriptionFields = z.infer<typeof TranscriptionFieldsSchema>;
export type Transcription = z.infer<typeof TranscriptionSchema>;
