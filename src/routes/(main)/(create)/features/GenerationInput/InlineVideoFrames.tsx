'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UploadCard, { UPLOAD_CARD_SIZE, type UploadData } from './UploadCard';

const STACK_OFFSET = -(UPLOAD_CARD_SIZE - 8);
const EXPAND_OFFSET = 4;

const styles = createStaticStyles(({ css }) => ({
  addCirclePos: css`
    position: absolute;
    z-index: 100;
    inset-block-end: -2px;
    inset-inline-end: -2px;
  `,
  refGroup: css`
    position: relative;
  `,
  stack: css`
    position: relative;
    padding-block: 4px;
    padding-inline: 0;

    &:hover {
      .inline-ref-close {
        opacity: 1;
      }
    }
  `,
  swapIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface InlineVideoFramesProps {
  endImageUrl?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  isSupportEndImage?: boolean;
  maxCount?: number;
  maxFileSize?: number;
  onEndImageChange: (data: UploadData | null) => void;
  onImageChange: (data: UploadData | null) => void;
  onImageUrlsChange?: (data: UploadData) => void;
  onRemoveImageUrl?: (url: string) => void;
}

const InlineVideoFrames = memo<InlineVideoFramesProps>(
  ({
    imageUrl,
    imageUrls,
    endImageUrl,
    onImageChange,
    onEndImageChange,
    onImageUrlsChange,
    onRemoveImageUrl,
    isSupportEndImage = true,
    maxCount = 5,
    maxFileSize,
  }) => {
    const { t } = useTranslation('video');
    const [isHovered, setIsHovered] = useState(false);

    // Combine imageUrl and imageUrls for display
    const refFrameUrls = useMemo(() => {
      const urls: string[] = [];
      if (imageUrl) urls.push(imageUrl);
      if (Array.isArray(imageUrls)) {
        urls.push(...imageUrls);
      }
      return urls;
    }, [imageUrl, imageUrls]);

    const hasRefFrames = refFrameUrls.length > 0;
    const canAddMore = refFrameUrls.length < maxCount;
    const shouldCollapse = hasRefFrames && !isHovered;
    const showEndFrame = isSupportEndImage && hasRefFrames;

    return (
      <Flexbox horizontal align={'end'} className={styles.stack} gap={6}>
        <Flexbox
          horizontal
          align={'end'}
          className={styles.refGroup}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Render ref frames (from imageUrl and imageUrls) */}
          {refFrameUrls.map((url, index) => {
            const isFromImageUrl = url === imageUrl;
            const label =
              index === 0 && isFromImageUrl
                ? t('config.imageUrl.label')
                : t('config.referenceImage.label');

            return (
              <UploadCard
                closeClassName="inline-ref-close"
                imageUrl={url}
                key={url}
                label={label}
                maxFileSize={maxFileSize}
                style={{
                  marginInlineStart:
                    index > 0 ? (shouldCollapse ? STACK_OFFSET : EXPAND_OFFSET) : 0,
                  zIndex: index + 1,
                }}
                onRemove={() => {
                  if (isFromImageUrl && imageUrl === url) {
                    onImageChange(null);
                  } else if (onRemoveImageUrl) {
                    onRemoveImageUrl(url);
                  }
                }}
                onUpload={
                  isFromImageUrl
                    ? (data) => onImageChange(data)
                    : (data) => onImageUrlsChange?.(data)
                }
              />
            );
          })}

          {/* Add new frame button */}
          {canAddMore &&
            (shouldCollapse ? (
              <UploadCard
                className={styles.addCirclePos}
                maxFileSize={maxFileSize}
                variant="circle"
                onRemove={() => {}}
                onUpload={(data) => {
                  if (onImageUrlsChange) {
                    onImageUrlsChange(data);
                  } else {
                    onImageChange(data);
                  }
                }}
              />
            ) : (
              <UploadCard
                imageUrl={null}
                label={t('config.referenceImage.label')}
                maxFileSize={maxFileSize}
                style={{
                  marginInlineStart: hasRefFrames ? EXPAND_OFFSET : 0,
                  zIndex: refFrameUrls.length + 1,
                }}
                onRemove={() => {}}
                onUpload={(data) => {
                  if (hasRefFrames) {
                    if (onImageUrlsChange) {
                      onImageUrlsChange(data);
                    } else {
                      onImageChange(data);
                    }
                  } else {
                    onImageChange(data);
                  }
                }}
              />
            ))}
        </Flexbox>

        {/* End frame separator and upload */}
        {showEndFrame && (
          <>
            <Flexbox
              align={'center'}
              className={styles.swapIcon}
              justify={'center'}
              style={{ height: UPLOAD_CARD_SIZE }}
            >
              <ArrowLeftRight size={14} />
            </Flexbox>

            <UploadCard
              imageUrl={endImageUrl}
              label={t('config.endImageUrl.label')}
              onRemove={() => onEndImageChange(null)}
              onUpload={(data) => onEndImageChange(data)}
            />
          </>
        )}
      </Flexbox>
    );
  },
);

InlineVideoFrames.displayName = 'InlineVideoFrames';

export default InlineVideoFrames;
