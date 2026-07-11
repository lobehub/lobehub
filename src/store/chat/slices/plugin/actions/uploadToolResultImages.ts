import type { ToolResultImage } from '@lobechat/tool-runtime';
import debug from 'debug';

import { getFileStoreState } from '@/store/file/store';

const log = debug('lobe-store:upload-tool-result-images');

/**
 * Rewrite pre-upload `{ data, mediaType }` entries in a builtin tool result's
 * `state.images` into uploaded `{ fileId, url, mediaType }` references BEFORE
 * the state is persisted as `pluginState` — raw base64 must never reach the
 * DB, and the LLM send path only forwards entries that carry a `url`.
 *
 * Mirrors the hetero pipeline's `uploadResultImages` degrade semantics: an
 * entry whose upload fails (or is declined) is dropped, leaving the
 * human-readable `[Image: …]` placeholder in `content` as the fallback; the
 * tool result itself never fails because of an upload error.
 */
export const uploadToolResultImages = async <T extends { images?: ToolResultImage[] }>(
  state: T | undefined,
): Promise<T | undefined> => {
  const images = state?.images;
  if (!state || !Array.isArray(images) || images.length === 0) return state;

  const uploaded: ToolResultImage[] = [];

  for (const image of images) {
    // Already uploaded (or nothing to upload) — pass through without the payload.
    if (!image?.data) {
      if (image?.url) uploaded.push(image);
      continue;
    }

    try {
      const file = await getFileStoreState().uploadBase64FileWithProgress(
        `data:${image.mediaType};base64,${image.data}`,
      );

      if (file?.url) {
        uploaded.push({ fileId: file.id, mediaType: image.mediaType, url: file.url });
      } else {
        log('upload declined for %s image, dropping entry', image.mediaType);
      }
    } catch (error) {
      log('upload failed for %s image, dropping entry: %O', image.mediaType, error);
    }
  }

  if (uploaded.length === 0) {
    const { images: _dropped, ...rest } = state;
    return rest as unknown as T;
  }

  return { ...state, images: uploaded };
};
