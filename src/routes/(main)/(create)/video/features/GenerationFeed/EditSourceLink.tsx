'use client';

import { Flexbox, Image, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CornerDownRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { VideoGenerationAsset } from '@/types/generation';

import { revealVideoGeneration, type VideoVersionNode } from './videoVersion';

const styles = stylex.create({
  link: {
    cursor: 'pointer',
    width: 'fit-content',
    maxWidth: '100%',
    paddingBlock: '2px',
    paddingInlineStart: '6px',
    paddingInlineEnd: '10px',
    borderRadius: '999px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: `background 0.15s ${cssVar.motionEaseInOut}`,
  },
  thumb: {
    overflow: 'hidden',
    flex: 'none',
    width: '32px',
    height: '20px',
    borderRadius: '4px',
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

interface EditSourceLinkProps {
  source?: VideoVersionNode;
  /** Version number of the source; used when the source card is no longer loaded. */
  sourceVersion: number;
}

/**
 * Shows which version an edit was made from; clicking it jumps back to that card.
 */
const EditSourceLink = memo<EditSourceLinkProps>(({ source, sourceVersion }) => {
  const { t } = useTranslation('video');

  if (!source) {
    return (
      <Flexbox horizontal align={'center'} gap={6}>
        <CornerDownRightIcon size={14} />
        <Text fontSize={12} type={'secondary'}>
          {t('generation.version.sourceDeleted')}
        </Text>
      </Flexbox>
    );
  }

  const asset = source.generation.asset as VideoGenerationAsset | null | undefined;
  const cover = asset?.coverUrl || asset?.thumbnailUrl;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.link).className}
      gap={6}
      role={'button'}
      // `role="button"` alone leaves it unreachable: it has to take focus and
      // answer Enter / Space the way a real button does.
      tabIndex={0}
      title={t('generation.version.locateSource')}
      onClick={() => revealVideoGeneration(source.generation.id)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        revealVideoGeneration(source.generation.id);
      }}
    >
      <CornerDownRightIcon size={14} style={{ flex: 'none' }} />
      {cover && (
        <div {...stylex.props(styles.thumb)}>
          <Image
            alt=""
            preview={false}
            src={cover}
            style={{ height: '100%', objectFit: 'cover', width: '100%' }}
          />
        </div>
      )}
      <Text ellipsis fontSize={12} style={{ color: 'inherit' }}>
        {t('generation.version.editedFrom', { version: String(sourceVersion) })}
        {source.batch.prompt ? ` · ${source.batch.prompt}` : ''}
      </Text>
    </Flexbox>
  );
});

EditSourceLink.displayName = 'EditSourceLink';

export default EditSourceLink;
