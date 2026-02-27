'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import ImageItem from '@/components/ImageItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  frameEnd: css`
    position: relative;
    transform: rotate(3deg);

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
      transform: rotate(1deg) scale(1.05);
    }
  `,
  frameInner: css`
    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: ${cssVar.borderRadiusSM}px;

    background: ${cssVar.colorBgLayout};
  `,
  frameStart: css`
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
}));

interface VideoReferenceFramesProps {
  endImageUrl?: string | null;
  imageUrl?: string | null;
}

const VideoReferenceFrames = memo<VideoReferenceFramesProps>(({ imageUrl, endImageUrl }) => {
  if (!imageUrl && !endImageUrl) return null;

  return (
    <Flexbox align={'center'} gap={12} horizontal>
      {imageUrl && (
        <div className={styles.frameStart}>
          <div className={styles.frameInner}>
            <ImageItem
              alt="Start frame"
              preview={{ src: imageUrl }}
              style={{ height: '100%', width: '100%' }}
              url={imageUrl}
            />
          </div>
        </div>
      )}
      {endImageUrl && (
        <div className={styles.frameEnd}>
          <div className={styles.frameInner}>
            <ImageItem
              alt="End frame"
              preview={{ src: endImageUrl }}
              style={{ height: '100%', width: '100%' }}
              url={endImageUrl}
            />
          </div>
        </div>
      )}
    </Flexbox>
  );
});

VideoReferenceFrames.displayName = 'VideoReferenceFrames';

export default VideoReferenceFrames;
