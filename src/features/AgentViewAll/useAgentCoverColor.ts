'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import { useEffect, useState } from 'react';

import { coverImageSrc, sampledImageColor, sampleImageColor, seedCoverColor } from './coverColor';

/**
 * Cover color of a badge-wall card, in order of preference: the avatar
 * background color the agent picked, the dominant color of its uploaded
 * avatar image, then the color of its generated character (from the id).
 *
 * Returns `undefined` while an image is still being sampled, so the card shows
 * a neutral band rather than flashing an unrelated seed color first, and when
 * the card shows a profile cover image instead (`hasCoverImage`), which needs none.
 */
export const useAgentCoverColor = (
  item: SidebarAgentItem,
  picked?: string,
  hasCoverImage?: boolean,
): string | undefined => {
  const src = picked || hasCoverImage ? undefined : coverImageSrc(item);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!src || sampledImageColor(src)) return;

    let active = true;
    sampleImageColor(src).then(() => {
      if (active) rerender((count) => count + 1);
    });

    return () => {
      active = false;
    };
  }, [src]);

  if (picked) return picked;
  if (hasCoverImage) return undefined;
  if (!src) return seedCoverColor(item);

  const sampled = sampledImageColor(src);
  if (!sampled) return undefined;

  return sampled.color || seedCoverColor(item);
};
