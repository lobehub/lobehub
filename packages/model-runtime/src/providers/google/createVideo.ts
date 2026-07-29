import type { GenerateVideosConfig, GoogleGenAI, Image } from '@google/genai';
import { GenerateVideosOperation } from '@google/genai';
import { imageUrlToBase64 } from '@lobechat/utils';
import debug from 'debug';

import type { CreateVideoPayload, CreateVideoResult } from '../../types/video';
import { AgentRuntimeError } from '../../utils/createError';
import { parseGoogleErrorMessage } from '../../utils/googleErrorParser';
import { parseDataUri } from '../../utils/uriParser';

const log = debug('lobe-video:google');
const GEMINI_OMNI_VIDEO_MODEL = 'gemini-omni-flash-preview';
const GOOGLE_FILE_DOWNLOAD_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface OmniVideoContent {
  data?: string;
  mime_type?: string;
  type?: 'video';
  uri?: string;
}

interface OmniInteraction {
  id: string;
  output_video?: OmniVideoContent;
  status: string;
  steps?: Array<{
    content?: Array<Record<string, unknown>>;
    error?: { message?: string };
    type?: string;
  }>;
  usage?: {
    total_output_tokens?: number;
    total_tokens?: number;
  };
}

export const isGeminiOmniVideoModel = (model: string) => model === GEMINI_OMNI_VIDEO_MODEL;

/**
 * Convert image URL to Google Image format
 * Supports: data URI, HTTP URL, and file paths
 */
async function imageToGoogleImageFormat(imageUrl: string): Promise<Image> {
  const { mimeType, base64, type } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }

    return {
      imageBytes: base64,
      mimeType: mimeType || 'image/png',
    };
  } else if (type === 'url') {
    // Handle both HTTP URLs and file paths (files/...)
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);

    return {
      imageBytes: urlBase64,
      mimeType: urlMimeType,
    };
  } else {
    throw new TypeError(`currently we don't support image url: ${imageUrl}`);
  }
}

async function imageToOmniContent(imageUrl: string) {
  const image = await imageToGoogleImageFormat(imageUrl);

  return {
    data: image.imageBytes,
    mime_type: image.mimeType || 'image/png',
    type: 'image' as const,
  };
}

function extractOmniVideo(interaction: OmniInteraction): OmniVideoContent | undefined {
  if (interaction.output_video) return interaction.output_video;

  for (const step of interaction.steps ?? []) {
    if (step.type !== 'model_output') continue;

    const video = step.content?.find((content) => content.type === 'video');
    if (video) return video as unknown as OmniVideoContent;
  }

  return undefined;
}

function extractOmniError(interaction: OmniInteraction): string {
  for (const step of interaction.steps ?? []) {
    if (step.error?.message) return step.error.message;
  }

  return `Gemini interaction ${interaction.status}`;
}

async function createGoogleOmniVideo(
  client: GoogleGenAI,
  payload: CreateVideoPayload,
): Promise<CreateVideoResult> {
  const { callbackUrl, model, params, previousInteractionId } = payload;
  const { aspectRatio, endImageUrl, imageUrl, imageUrls, prompt } = params;
  const images = [imageUrl, ...(imageUrls ?? []), endImageUrl].filter((url): url is string =>
    Boolean(url),
  );

  /**
   * Infer the task from the actual request media. Persisted generation parameters and older
   * clients can retain a stale `text_to_video` value after images are added, which Gemini rejects.
   */
  const resolvedTask = previousInteractionId
    ? 'edit'
    : images.length > 1
      ? 'reference_to_video'
      : images.length === 1
        ? 'image_to_video'
        : 'text_to_video';
  /**
   * Stateful continuation already restores the source media from `previous_interaction_id`.
   * Re-sending persisted frame inputs can make Gemini reject the edit as conflicting media.
   */
  const input = previousInteractionId
    ? prompt
    : images.length === 0
      ? prompt
      : [
          ...(await Promise.all(images.map((url) => imageToOmniContent(url)))),
          { text: prompt, type: 'text' as const },
        ];

  const interaction = (await client.interactions.create({
    api_version: 'v1beta',
    background: true,
    ...(previousInteractionId
      ? {}
      : { generation_config: { video_config: { task: resolvedTask } } }),
    input,
    model,
    ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    response_format: {
      ...(aspectRatio ? { aspect_ratio: aspectRatio as '16:9' | '9:16' } : {}),
      delivery: 'uri',
      type: 'video',
    },
    store: true,
    ...(callbackUrl
      ? {
          webhook_config: {
            uris: [callbackUrl],
          },
        }
      : {}),
  })) as OmniInteraction;

  if (!interaction.id) throw new Error('Gemini interaction response is missing an id');

  return { inferenceId: interaction.id };
}

export async function createGoogleVideo(
  client: GoogleGenAI,
  provider: string,
  payload: CreateVideoPayload,
): Promise<CreateVideoResult> {
  try {
    const { model, params } = payload;

    if (isGeminiOmniVideoModel(model)) {
      return await createGoogleOmniVideo(client, payload);
    }

    const {
      prompt,
      imageUrl,
      imageUrls,
      endImageUrl,
      aspectRatio,
      duration,
      resolution,
      seed,
      generateAudio, // generateAudio parameter is not supported in Gemini API.
    } = params;

    log('Creating video with Google AI - model: %s, params: %O', model, params);

    // https://github.com/googleapis/js-genai/blob/main/src/types.ts
    const config: GenerateVideosConfig = {
      ...(aspectRatio && { aspectRatio }),
      ...(duration && { durationSeconds: duration }),
      ...(endImageUrl ? { lastFrame: await imageToGoogleImageFormat(endImageUrl) } : {}),
      ...(generateAudio && { generateAudio }),
      ...(resolution && { resolution }),
      ...(seed !== undefined && seed !== null && { seed }),
    };

    const requestParams: any = {
      model,
      prompt,
      ...(imageUrl ? { image: await imageToGoogleImageFormat(imageUrl) } : {}),
      ...(config && { config }),
    };

    if (imageUrls && imageUrls.length > 0) {
      if (imageUrls.length === 1) {
        requestParams.image = await imageToGoogleImageFormat(imageUrls[0]);
      } else {
        requestParams.config.referenceImages = await Promise.all(
          imageUrls.map(async (url) => ({
            image: await imageToGoogleImageFormat(url),
          })),
        );
      }
    }

    log('Google video generation request params: %O', requestParams);

    const operation = await client.models.generateVideos(requestParams);

    log('Video generation started, operation name: %s', operation.name);

    return { inferenceId: operation.name || '' };
  } catch (error) {
    const err = error as Error;
    log('Error creating video with Google AI: %O', err);

    if ((err as any)?.errorType) {
      throw err;
    }

    const { errorType, error: parsedError } = parseGoogleErrorMessage(err.message);
    throw AgentRuntimeError.createVideo({
      error: parsedError,
      errorType,
      provider,
    });
  }
}

async function pollGoogleOmniInteraction(client: GoogleGenAI, inferenceId: string, apiKey: string) {
  const interaction = (await client.interactions.get(inferenceId, {
    api_version: 'v1beta',
  })) as OmniInteraction;
  const completionTokens = interaction.usage?.total_output_tokens;
  const usage =
    completionTokens && completionTokens > 0
      ? {
          completionTokens,
          totalTokens: interaction.usage?.total_tokens ?? completionTokens,
        }
      : undefined;

  if (interaction.status === 'queued' || interaction.status === 'in_progress') {
    return { status: 'pending' as const };
  }

  if (interaction.status !== 'completed') {
    return {
      error: extractOmniError(interaction),
      status: 'failed' as const,
    };
  }

  const video = extractOmniVideo(interaction);
  if (!video) {
    return {
      error: 'Gemini interaction completed without video output',
      status: 'failed' as const,
    };
  }

  if (video.data) {
    return {
      status: 'success' as const,
      ...(usage ? { usage } : {}),
      videoUrl: `data:${video.mime_type || 'video/mp4'};base64,${video.data}`,
    };
  }

  if (!video.uri) {
    return {
      error: 'Gemini interaction video output is missing data and URI',
      status: 'failed' as const,
    };
  }

  const fileMatch = video.uri.match(/(?:^|\/)(files\/[^/:?#]+)/);
  if (!fileMatch) {
    return {
      headers: { 'x-goog-api-key': apiKey },
      status: 'success' as const,
      ...(usage ? { usage } : {}),
      videoUrl: video.uri,
    };
  }

  const file = await client.files.get({ name: fileMatch[1] });
  const fileState = String(file.state ?? '').toUpperCase();

  if (fileState === 'FAILED') {
    return {
      error: file.error?.message || 'Gemini generated video file processing failed',
      status: 'failed' as const,
    };
  }

  if (fileState !== 'ACTIVE') return { status: 'pending' as const };

  return {
    headers: { 'x-goog-api-key': apiKey },
    status: 'success' as const,
    ...(usage ? { usage } : {}),
    videoUrl:
      file.downloadUri || `${GOOGLE_FILE_DOWNLOAD_BASE_URL}/${fileMatch[1]}:download?alt=media`,
  };
}

export async function pollGoogleVideoOperation(
  client: GoogleGenAI,
  inferenceId: string,
  provider: string,
  apiKey: string,
): Promise<
  | {
      headers?: Record<string, string>;
      status: 'success';
      usage?: { completionTokens: number; totalTokens: number };
      videoUrl: string;
    }
  | { status: 'failed'; error: string }
  | { status: 'pending' }
> {
  try {
    log('Polling video operation status: %s', inferenceId);

    if (!inferenceId) {
      return { error: 'Invalid operation name', status: 'failed' };
    }

    if (!inferenceId.startsWith('operations/') && !inferenceId.includes('/operations/')) {
      return await pollGoogleOmniInteraction(client, inferenceId, apiKey);
    }

    // Create a proper GenerateVideosOperation instance from the operation name
    const operation = new GenerateVideosOperation();
    operation.name = inferenceId;

    const updatedOperation = await client.operations.getVideosOperation({
      operation,
    });

    log('Video operation status: %O', updatedOperation);

    if (updatedOperation.done) {
      if (updatedOperation.error) {
        const errorMessage = (updatedOperation.error as any)?.message || 'Video generation failed';
        return {
          error: errorMessage,
          status: 'failed',
        };
      }

      if (!updatedOperation.response?.generatedVideos?.[0]?.video) {
        if (updatedOperation?.response?.raiMediaFilteredReasons) {
          return {
            error: updatedOperation.response.raiMediaFilteredReasons[0],
            status: 'failed',
          };
        }

        return {
          error: 'No video generated',
          status: 'failed',
        };
      }

      const video = updatedOperation.response.generatedVideos[0].video;
      const videoUrl = video.uri;

      if (!videoUrl) {
        return {
          error: 'Video URL is empty',
          status: 'failed',
        };
      }

      log('Video generation completed, download URI: %s', videoUrl);

      // Return headers for authenticated download
      // Google uses x-goog-api-key header
      return {
        headers: {
          'x-goog-api-key': apiKey,
        },
        status: 'success',
        videoUrl,
      };
    }

    log('Video generation still in progress');
    return { status: 'pending' };
  } catch (error) {
    const err = error as Error;
    log('Error polling video operation: %O', err);

    return {
      error: err.message || 'Failed to poll video status',
      status: 'failed',
    };
  }
}
