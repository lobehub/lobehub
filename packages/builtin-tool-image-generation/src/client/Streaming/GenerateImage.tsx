'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GenerateImageParams } from '../../types';
import { resolveAspectRatio } from '../components/aspectRatio';
import { startGenerationClock } from '../components/generationClock';
import ImageCanvas from '../components/ImageCanvas';
import ImageCanvasGrid from '../components/ImageCanvasGrid';

const MAX_CANVASES = 4;

/**
 * Fills the gap between "the model decided to draw" and "the tool returned":
 * the same canvases the Render will develop the images on, already in place.
 */
export const GenerateImageStreaming = memo<BuiltinStreamingProps<Partial<GenerateImageParams>>>(
  ({ args, toolCallId }) => {
    const { t } = useTranslation('plugin');
    const [startedAt] = useState(() => startGenerationClock(toolCallId));
    const imageNum = typeof args?.imageNum === 'number' ? args.imageNum : 1;
    const count = Math.min(MAX_CANVASES, Math.max(1, Math.round(imageNum)));
    const ratio = resolveAspectRatio(args?.parameters);

    return (
      <ImageCanvasGrid count={count} ratio={ratio}>
        {Array.from({ length: count }, (_, index) => (
          <ImageCanvas
            badge={t('builtins.lobe-image-generation.render.status.processing')}
            key={index}
            ratio={ratio}
            seed={index}
            startedAt={startedAt}
          />
        ))}
      </ImageCanvasGrid>
    );
  },
);

GenerateImageStreaming.displayName = 'GenerateImageStreaming';

export default GenerateImageStreaming;
