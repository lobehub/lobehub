'use client';

import { ActionIcon, Flexbox, Image } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { QuoteIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  container: { flexShrink: 0, width: '48px', height: '48px', marginInlineStart: '-16px' },
  icon: {
    pointerEvents: 'none',
    zIndex: 10,
    borderRadius: '50%',
    color: cssVar.colorBgLayout,
    backgroundColor: cssVar.colorFill,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
  },
  image: { padding: '2px', boxShadow: cssVar.boxShadowTertiary },
  imageEl: { borderRadius: '6px' },
});

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
          className={stylex.props(styles.icon).className}
          icon={QuoteIcon}
          size={'small'}
          variant={'filled'}
        />
        {allImages.map((url, index) => (
          <div {...stylex.props(styles.container)} key={`${url}-${index}`}>
            <Image
              alt={`Reference image ${index + 1}`}
              className={stylex.props(styles.image).className}
              classNames={{ image: stylex.props(styles.imageEl).className }}
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
