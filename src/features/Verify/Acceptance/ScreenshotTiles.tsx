'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Image } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useState } from 'react';

import {
  annotationInSlice,
  isPortraitScreenshot,
  screenshotSliceObjectPosition,
  screenshotSlices,
  screenshotTileWidth,
} from './screenshotSlices';

type Rect = AcceptanceReviewAnnotation['rect'];

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    position: absolute;
    inset-block-start: -9px;
    inset-inline-start: -9px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: #fff;

    background: ${cssVar.colorError};
  `,
  frame: css`
    position: relative;

    overflow: hidden;
    flex: none;

    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  rect: css`
    pointer-events: none;

    position: absolute;

    border: 2px solid ${cssVar.colorError};
    border-radius: 4px;

    box-shadow: 0 0 0 1px rgb(0 0 0 / 25%);
  `,
}));

interface ScreenshotTilesProps {
  alt: string;
  annotations?: { comment?: string; label?: number; rect: Rect }[];
  caption?: ReactNode;
  fileHeight?: number | null;
  fileWidth?: number | null;
  src: string;
}

export const ScreenshotTiles = memo<ScreenshotTilesProps>(
  ({ alt, annotations, caption, fileHeight, fileWidth, src }) => {
    const [natural, setNatural] = useState(
      fileWidth && fileHeight ? { height: fileHeight, width: fileWidth } : undefined,
    );

    const slices = natural ? screenshotSlices(natural.width, natural.height) : undefined;
    const numbered =
      (annotations?.length ?? 0) > 1 || annotations?.some((item) => item.label !== undefined);

    const rememberSize = (event: { currentTarget: HTMLImageElement }) => {
      if (natural) return;
      setNatural({
        height: event.currentTarget.naturalHeight,
        width: event.currentTarget.naturalWidth,
      });
    };

    const shell = (width: string | number, body: ReactNode) => (
      <Flexbox gap={4} style={{ maxWidth: '100%', width }}>
        {body}
        {caption}
      </Flexbox>
    );

    if (!natural) {
      return shell(
        '100%',
        <div className={styles.frame} style={{ maxWidth: '100%', width: '100%' }}>
          <Image
            alt={alt}
            loading={'lazy'}
            src={src}
            variant={'borderless'}
            width={'100%'}
            onLoad={rememberSize}
          />
        </div>,
      );
    }

    if (slices) {
      return shell(
        '100%',
        <Flexbox horizontal align={'flex-start'} gap={12} wrap={'wrap'}>
          {slices.map((slice) => {
            const local = annotations
              ?.map((annotation, index) => {
                const rect = annotationInSlice(annotation.rect, slice, natural.height);
                if (!rect) return;
                return { ...annotation, index, rect };
              })
              .filter((item) => item !== undefined);

            return (
              <div
                className={styles.frame}
                key={slice.index}
                style={{
                  aspectRatio: `${natural.width} / ${slice.height}`,
                  width: screenshotTileWidth(natural.width),
                }}
              >
                <Image
                  alt={alt}
                  height={'100%'}
                  loading={'lazy'}
                  maxHeight={'none'}
                  maxWidth={'none'}
                  objectFit={'cover'}
                  src={src}
                  style={{ height: '100%', width: '100%' }}
                  variant={'borderless'}
                  width={'100%'}
                  styles={{
                    image: {
                      height: '100%',
                      objectPosition: screenshotSliceObjectPosition(slice, natural.height),
                      width: '100%',
                    },
                    wrapper: { height: '100%', width: '100%' },
                  }}
                />
                {local?.map((annotation) => (
                  <div
                    className={styles.rect}
                    key={annotation.index}
                    style={{
                      height: `${annotation.rect.height * 100}%`,
                      left: `${annotation.rect.x * 100}%`,
                      top: `${annotation.rect.y * 100}%`,
                      width: `${annotation.rect.width * 100}%`,
                    }}
                  >
                    {numbered && (
                      <span className={styles.badge}>
                        {annotation.label ?? annotation.index + 1}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </Flexbox>,
      );
    }

    const portrait = isPortraitScreenshot(natural.width, natural.height);

    return shell(
      portrait ? screenshotTileWidth(natural.width) : '100%',
      <div
        className={styles.frame}
        style={{
          aspectRatio: `${natural.width} / ${natural.height}`,
          maxWidth: '100%',
          width: '100%',
        }}
      >
        <Image
          alt={alt}
          loading={'lazy'}
          maxHeight={'none'}
          maxWidth={'none'}
          objectFit={'contain'}
          src={src}
          style={{ width: '100%' }}
          variant={'borderless'}
          width={'100%'}
        />
        {annotations?.map((annotation, index) => (
          <div
            className={styles.rect}
            key={index}
            style={{
              height: `${annotation.rect.height * 100}%`,
              left: `${annotation.rect.x * 100}%`,
              top: `${annotation.rect.y * 100}%`,
              width: `${annotation.rect.width * 100}%`,
            }}
          >
            {numbered && <span className={styles.badge}>{annotation.label ?? index + 1}</span>}
          </div>
        ))}
      </div>,
    );
  },
);

ScreenshotTiles.displayName = 'AcceptanceScreenshotTiles';
