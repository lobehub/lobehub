import type { MusicProcessResult } from '@/server/services/generation/music';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

interface BuildMusicGenerationFilePayloadParams {
  generationId: string;
  processResult: MusicProcessResult;
  prompt?: string | null;
  /** Song title, preferred over the prompt for the file name */
  title?: string | null;
}

/**
 * File record of a stored song. Keeps metadata.path so UI hash dedup treats it like an upload.
 */
export const buildMusicGenerationFilePayload = ({
  generationId,
  processResult,
  prompt,
  title,
}: BuildMusicGenerationFilePayloadParams) => {
  const ext = processResult.audioKey.match(/\.[a-z\d]+$/i)?.[0] ?? '.mp3';
  const name = `${sanitizeFileName(title || prompt || '', generationId)}${ext}`;
  const dirname = processResult.audioKey.split('/').slice(0, -1).join('/');

  return {
    fileHash: processResult.fileHash,
    fileType: processResult.mimeType,
    metadata: {
      date: new Date().toISOString().slice(0, 10),
      dirname,
      duration: processResult.duration,
      filename: name,
      generationId,
      path: processResult.audioKey,
    },
    name,
    size: processResult.fileSize,
    url: processResult.audioKey,
  };
};
