'use client';

import { ActionIcon, Flexbox, Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { QuoteIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    margin-inline-start: -16px;
  `,
  image: css`
    padding: 2px;
    box-shadow: ${cssVar.boxShadowTertiary};

    img {
      border-radius: 6px;
    }
  `,
  icon: css`
    pointer-events: none;

    z-index: 10;

    border-radius: 50% !important;

    color: ${cssVar.colorBgLayout};

    background: ${cssVar.colorFill};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
}));

interface ReferenceImagesProps {
  imageUrl?: string | null;
  imageUrls?: string[];
}

export const ReferenceImages = memo<ReferenceImagesProps>(({ imageUrl, imageUrls }) => {
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

  return (
    <Image.PreviewGroup>
      <Flexbox horizontal align={'flex-end'} flex={'none'} wrap="wrap">
        <ActionIcon
          glass
          className={styles.icon}
          icon={QuoteIcon}
          size={'small'}
          variant={'filled'}
        />
        {allImages.map((url, index) => (
          <div className={styles.container} key={`${url}-${index}`}>
            <Image
              alt={`Reference image ${index + 1}`}
              className={styles.image}
              height={'100%'}
              src={url}
              style={{ height: '100%', width: '100%' }}
              variant={'outlined'}
              width={'100%'}
            />
          </div>
        ))}
      </Flexbox>
    </Image.PreviewGroup>
  );
});

ReferenceImages.displayName = 'ReferenceImages';
