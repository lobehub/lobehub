import type { VideoGenerationCompletionMode } from '@lobechat/types';

import type { LobeRuntimeAI } from '../core/BaseAI';
import type {
  CreateVideoMethodOptions,
  CreateVideoPayload,
  CreateVideoResponse,
  VideoGenerationCapabilities,
} from '../types/video';

interface ResolveVideoCompletionModeOptions {
  callbackUrl?: string;
  capabilities: VideoGenerationCapabilities;
  preferredCompletionMode?: VideoGenerationCompletionMode;
}

/**
 * Resolve exactly one completion mode before the provider request is submitted.
 *
 * The deployment preference is best-effort: runtimes may fall back to their only supported
 * mode, while webhook mode additionally requires a callback URL for the current request.
 */
export const resolveVideoCompletionMode = ({
  capabilities,
  callbackUrl,
  preferredCompletionMode = 'polling',
}: ResolveVideoCompletionModeOptions): VideoGenerationCompletionMode => {
  const supportsPolling = capabilities.completionModes.includes('polling');
  const supportsWebhook = capabilities.completionModes.includes('webhook');

  if (preferredCompletionMode === 'webhook' && supportsWebhook && callbackUrl) return 'webhook';
  if (preferredCompletionMode === 'polling' && supportsPolling) return 'polling';

  if (supportsPolling) return 'polling';
  if (supportsWebhook && callbackUrl) return 'webhook';

  throw new Error(
    supportsWebhook
      ? 'Video generation requires a webhook callback URL'
      : 'Video generation runtime does not declare a supported completion mode',
  );
};

export const prepareVideoPayload = (
  payload: CreateVideoPayload,
  completionMode: VideoGenerationCompletionMode,
): CreateVideoPayload => {
  if (completionMode === 'webhook') return payload;

  const { callbackUrl: _, ...pollingPayload } = payload;
  return pollingPayload;
};

export const createVideoWithCompletionMode = async (
  runtime: LobeRuntimeAI,
  payload: CreateVideoPayload,
  options?: CreateVideoMethodOptions,
): Promise<CreateVideoResponse> => {
  if (!runtime.createVideo) throw new Error('Video generation is not supported by this runtime');
  if (runtime.orchestratesVideoGenerationCompletion) {
    return runtime.createVideo(payload, options) as Promise<CreateVideoResponse>;
  }
  if (!runtime.getVideoGenerationCapabilities) {
    throw new Error('Video generation runtime does not declare completion capabilities');
  }

  const completionMode = resolveVideoCompletionMode({
    callbackUrl: payload.callbackUrl,
    capabilities: runtime.getVideoGenerationCapabilities(payload.model),
    preferredCompletionMode: options?.preferredCompletionMode,
  });
  const result = await runtime.createVideo(prepareVideoPayload(payload, completionMode), options);

  return { ...result, completionMode };
};
