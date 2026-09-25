'use client';

import { Flexbox, Image } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CornerDownRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { VideoGenerationAsset } from '@/types/generation';

import { revealVideoGeneration, type VideoVersionNode } from './videoVersion';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    cursor: pointer;

    width: fit-content;
    max-width: 100%;
    padding-block: 2px;
    padding-inline: 6px 10px;
    border-radius: 999px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    transition: background 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  thumb: css`
    overflow: hidden;
    flex: none;

    width: 32px;
    height: 20px;
    border-radius: 4px;

    background: ${cssVar.colorFillSecondary};
  `,
}));

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
      className={styles.link}
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
        <div className={styles.thumb}>
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
