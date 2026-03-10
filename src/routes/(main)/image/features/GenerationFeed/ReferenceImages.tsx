'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import ImageItem from '@/components/ImageItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    gap: 8px;
    margin-block-end: 12px;
  `,
  image: css`
    overflow: hidden;
    flex-shrink: 0;

    width: 60px;
    height: 60px;
    border-radius: ${cssVar.borderRadius}px;
  `,
  imageSingle: css`
    position: relative;
    transform: rotate(-3deg);

    flex-shrink: 0;

    width: 64px;
    height: 64px;

    transition: transform 0.2s ease;

    &::before {
      content: '';

      position: absolute;
      z-index: -1;
      inset: -4px;

      border: 1px solid ${cssVar.colorBorder};
      border-radius: ${cssVar.borderRadius}px;

      background: ${cssVar.colorBgContainer};
      box-shadow: 0 2px 8px ${cssVar.colorBgMask};
    }

    &:hover {
      transform: rotate(-1deg) scale(1.05);
    }
  `,
  imageSingleInner: css`
    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: ${cssVar.borderRadiusSM}px;

    background: ${cssVar.colorBgLayout};
  `,
}));

interface ReferenceImagesProps {
  imageUrl?: string | null;
  imageUrls?: string[];
  layout?: 'single' | 'multiple';
}

export const ReferenceImages = memo<ReferenceImagesProps>(({ imageUrl, imageUrls, layout }) => {
  // Collect all images
  const allImages: string[] = [];
  if (imageUrl) {
    allImages.push(imageUrl);
  }
  if (imageUrls && imageUrls.length > 0) {
    allImages.push(...imageUrls);
  }

  // Don't render if no images
  if (allImages.length === 0) {
    return null;
  }

  // Single image layout (no label, with frame effect)
  if (layout === 'single' && allImages.length === 1) {
    return (
      <div className={styles.imageSingle}>
        <div className={styles.imageSingleInner}>
          <ImageItem
            alt="Reference image"
            style={{ height: '100%', width: '100%' }}
            url={allImages[0]}
            preview={{
              src: allImages[0],
            }}
          />
        </div>
      </div>
    );
  }

  // Multiple images layout
  return (
    <Flexbox horizontal className={styles.container} wrap="wrap">
      {allImages.map((url, index) => (
        <div className={styles.image} key={`${url}-${index}`}>
          <ImageItem
            alt={`Reference image ${index + 1}`}
            style={{ height: '100%', width: '100%' }}
            url={url}
            preview={{
              src: url,
            }}
          />
        </div>
      ))}
    </Flexbox>
  );
});

ReferenceImages.displayName = 'ReferenceImages';
