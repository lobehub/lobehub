import type { MusicGenerationAsset } from '@lobechat/types';

import type { Generation, GenerationBatch } from '@/types/generation';

/** Generations store their asset in one jsonb column; songs are the `audio` shape */
export const getMusicAsset = (generation: Generation): MusicGenerationAsset | undefined => {
  const asset = generation.asset as unknown as MusicGenerationAsset | null | undefined;
  return asset?.type === 'audio' ? asset : undefined;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};

export const getAudioExtension = (mimeType?: string, format?: string) =>
  (mimeType && EXTENSION_BY_MIME[mimeType.toLowerCase()]) || format || 'mp3';

/** Seconds → `m:ss` */
export const formatSongDuration = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A file name safe on every OS: the song title, else the prompt, else `fallback` */
export const getSongFileName = ({
  asset,
  batch,
  fallback,
  index,
}: {
  asset: MusicGenerationAsset;
  batch: GenerationBatch;
  fallback: string;
  index: number;
}) => {
  const config = batch.config as { format?: string; title?: string | null } | undefined;
  const base = (asset.title || config?.title || batch.prompt || '').slice(0, 40).trim();
  const safe =
    base.replaceAll(/["%*/:<>?\\|]/g, '').replaceAll(/\s+/g, '_') ||
    fallback.replaceAll(/\s+/g, '_');
  const suffix = batch.generations.length > 1 ? `_${index + 1}` : '';

  return `${safe}${suffix}.${getAudioExtension(asset.mimeType, config?.format)}`;
};
