'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import UploadCard, { UPLOAD_CARD_SIZE, type UploadData } from './UploadCard';

const styles = createStaticStyles(({ css }) => ({
  stack: css`
    position: relative;
    padding-block: 4px;
    padding-inline: 0;
  `,
  swapIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface InlineVideoFramesProps {
  endImageUrl?: string | null;
  imageUrl?: string | null;
  isSupportEndImage?: boolean;
  maxFileSize?: number;
  onEndImageChange: (data: UploadData | null) => void;
  onImageChange: (data: UploadData | null) => void;
}

const InlineVideoFrames = memo<InlineVideoFramesProps>(
  ({ imageUrl, endImageUrl, onImageChange, onEndImageChange, isSupportEndImage = true }) => {
    const { t } = useTranslation('video');

    const hasStartFrame = Boolean(imageUrl);
    const showEndFrame = isSupportEndImage && hasStartFrame;

    return (
      <Flexbox horizontal align={'end'} className={styles.stack} gap={6}>
        <UploadCard
          imageUrl={imageUrl}
          label={hasStartFrame ? t('config.imageUrl.label') : t('config.referenceImage.label')}
          onRemove={() => onImageChange(null)}
          onUpload={(data) => onImageChange(data)}
        />

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
