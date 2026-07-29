import type { VideoProcessResult } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

interface BuildVideoGenerationFilePayloadParams {
  generationId: string;
  processResult: VideoProcessResult;
  prompt?: string | null;
}

/**
 * Keeps generated video files compatible with UI hash dedup, which reads metadata.path.
 */
export const buildVideoGenerationFilePayload = ({
  generationId,
  processResult,
  prompt,
}: BuildVideoGenerationFilePayloadParams) => {
  const name = `${sanitizeFileName(prompt ?? '', generationId)}.mp4`;
  const dirname = processResult.videoKey.split('/').slice(0, -1).join('/');

  return {
    fileHash: processResult.fileHash,
    fileType: processResult.mimeType,
    metadata: {
      date: new Date().toISOString().slice(0, 10),
      dirname,
      duration: processResult.duration,
      filename: name,
      generationId,
      height: processResult.height,
      path: processResult.videoKey,
      width: processResult.width,
    },
    name,
    size: processResult.fileSize,
    url: processResult.videoKey,
  };
};
