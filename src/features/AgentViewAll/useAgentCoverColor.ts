'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import { useEffect, useState } from 'react';

import { coverImageSrc, sampleImageColor, seedCoverColor } from './coverColor';

/**
 * Cover color of a badge-wall card, in order of preference: the avatar
 * background color the agent picked, the dominant color of its uploaded
 * avatar image, then the color of its generated character (from the id).
 */
export const useAgentCoverColor = (item: SidebarAgentItem, picked?: string): string => {
  const src = picked ? undefined : coverImageSrc(item);
  const [sampled, setSampled] = useState<{ color?: string; src: string }>();

  useEffect(() => {
    if (!src) return;

    let active = true;
    sampleImageColor(src).then((color) => {
      if (active) setSampled({ color, src });
    });

    return () => {
      active = false;
    };
  }, [src]);

  const imageColor = src && sampled?.src === src ? sampled.color : undefined;

  return picked || imageColor || seedCoverColor(item);
};
