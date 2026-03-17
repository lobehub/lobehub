import createDebug from 'debug';
import type OpenAI from 'openai';
import type { Video, VideoCreateParams, VideoSeconds, VideoSize } from 'openai/resources';

import type {
  CreateVideoPayload,
  CreateVideoResponse,
  PollVideoStatusResult,
} from '../../types/video';

const log = createDebug('lobe-video:openai-compatible');

export async function createOpenAICompatibleVideo(
  client: OpenAI,
  payload: CreateVideoPayload,
  provider: string,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, size, duration } = params;

  log('Creating video with OpenAI SDK - model: %s, params: %O', model, params);

  const options: VideoCreateParams = {
    model,
    prompt,
  };

  if (duration !== undefined && duration !== null) {
    options.seconds = duration.toString() as VideoSeconds;
  }

  if (size) {
    options.size = size as VideoSize;
  }

  if (imageUrl) {
    options.input_reference = { image_url: imageUrl };
  }

  log('OpenAI SDK video create params: %O', options);

  try {
    const video = await client.videos.create(options);

    log('Video task created with id: %s', video.id);

    return { inferenceId: video.id };
  } catch (error) {
    log('Error creating video with OpenAI SDK: %O', error);
    throw error;
  }
}

export async function queryOpenAICompatibleVideoStatus(
  client: OpenAI,
  inferenceId: string,
): Promise<Video> {
  log('Querying video status for: %s', inferenceId);

  const video = await client.videos.retrieve(inferenceId);
  log('Video status response: %O', video);

  return video;
}

export async function handlePollOpenAICompatibleVideoStatus(
  client: OpenAI,
  inferenceId: string,
  provider: string,
): Promise<PollVideoStatusResult> {
  const response = await queryOpenAICompatibleVideoStatus(client, inferenceId);

  if (response.status === 'completed') {
    const videoUrl = `${(client as any).baseURL}/videos/${inferenceId}/content`;

    return {
      apiKey: (client as any).apiKey,
      status: 'success',
      videoUrl,
    };
  }

  if (response.status === 'failed') {
    return {
      error: (response.error as any)?.message || 'Video generation failed',
      status: 'failed',
    };
  }

  return { status: 'pending' };
}
