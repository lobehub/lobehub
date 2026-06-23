'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';

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
}));

interface InlineImageReferenceProps {
  imageConstraints?: any;
  images: string[];
  maxCount?: number;
  maxFileSize?: number;
  onAdd: (data: UploadData) => void;
  onRemove: (url: string) => void;
  /** Optional batch upload handler to enable multi-select on the add card. */
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  /** In-flight upload previews (object URLs) rendered with a spinner. */
  uploadingPreviews?: string[];
}

const InlineImageReference = memo<InlineImageReferenceProps>(
  ({
    images,
    onAdd,
    onRemove,
    onUploadFiles,
    maxFileSize,
    maxCount = 5,
    uploadingPreviews = [],
  }) => {
    const [isHovered, setIsHovered] = useState(false);

    const totalCount = images.length + uploadingPreviews.length;
    const canAddMore = totalCount < maxCount;
    const hasItems = totalCount > 0;
    const shouldCollapse = hasItems && !isHovered;

    const stackOffset = (index: number) =>
      index > 0 ? (shouldCollapse ? STACK_OFFSET : EXPAND_OFFSET) : 0;

    return (
      <Flexbox
        horizontal
        align={'end'}
        className={styles.stack}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {images.map((url, index) => (
          <UploadCard
            closeClassName="inline-ref-close"
            imageUrl={url}
            key={url}
            maxFileSize={maxFileSize}
            style={{
              marginInlineStart: stackOffset(index),
              zIndex: index + 1,
            }}
            onRemove={() => onRemove(url)}
            onUpload={onAdd}
          />
        ))}

        {uploadingPreviews.map((url, index) => (
          <UploadCard
            loading
            imageUrl={url}
            key={`uploading-${url}`}
            maxFileSize={maxFileSize}
            style={{
              marginInlineStart: stackOffset(images.length + index),
              zIndex: images.length + index + 1,
            }}
            onRemove={() => {}}
            onUpload={() => {}}
          />
        ))}

        {canAddMore &&
          (shouldCollapse ? (
            <UploadCard
              className={styles.addCirclePos}
              maxFileSize={maxFileSize}
              multiple={!!onUploadFiles}
              variant="circle"
              onRemove={() => {}}
              onUpload={onAdd}
              onUploadFiles={onUploadFiles}
            />
          ) : (
            <UploadCard
              maxFileSize={maxFileSize}
              multiple={!!onUploadFiles}
              style={{
                marginInlineStart: hasItems ? EXPAND_OFFSET : 0,
                zIndex: totalCount + 1,
              }}
              onRemove={() => {}}
              onUpload={onAdd}
              onUploadFiles={onUploadFiles}
            />
          ))}
      </Flexbox>
    );
  },
);

InlineImageReference.displayName = 'InlineImageReference';

export default InlineImageReference;
