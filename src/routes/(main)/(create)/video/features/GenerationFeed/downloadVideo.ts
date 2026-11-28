import dayjs from 'dayjs';

import type { Generation, VideoGenerationAsset } from '@/types/generation';
import { downloadFile } from '@/utils/client/downloadFile';

export const downloadGeneratedVideo = async (
  generation: Generation | undefined,
  prompt: string,
) => {
  const asset = generation?.asset as VideoGenerationAsset | null | undefined;
  if (!generation || !asset?.url) return;

  const timestamp = dayjs(generation.createdAt).format('YYYY-MM-DD_HH-mm-ss');
  const baseName = prompt.slice(0, 30).trim();
  const sanitizedBaseName = baseName.replaceAll(/["%*/:<>?\\|]/g, '').replaceAll(/\s+/g, '_');
  const safePrompt = sanitizedBaseName || 'Untitled';
  const fileName = `${safePrompt}_${timestamp}.${asset.fileExtension ?? 'mp4'}`;

  try {
    await downloadFile(asset.url, fileName, false);
  } catch (error) {
    console.error('Failed to download video:', error);
  }
};
