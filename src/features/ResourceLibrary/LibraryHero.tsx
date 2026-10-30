'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LibraryStatusIcon from '@/components/LibIcon/StatusIcon';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

const styles = stylex.create({
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    maxWidth: '720px',
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
});

interface LibraryHeroProps {
  library: KnowledgeBaseItem;
}

/**
 * The top of a knowledge base's root view: its name and description. The cover
 * belongs to the gallery card; it is changed from the edit form, not here.
 */
const LibraryHero = memo<LibraryHeroProps>(({ library }) => {
  const { t } = useTranslation('file');

  return (
    <Flexbox flex={'none'} gap={6} paddingBlock={20} paddingInline={24}>
      <Flexbox horizontal align={'center'} gap={8}>
        <LibraryStatusIcon
          memberRestricted={(library as { memberRestricted?: boolean }).memberRestricted}
          size={20}
          visibility={library.visibility}
        />
        <h1 {...stylex.props(styles.title)}>{library.name}</h1>
      </Flexbox>
      {library.description ? (
        <div {...stylex.props(styles.description)}>{library.description}</div>
      ) : (
        <Text fontSize={13} type={'secondary'}>
          {t('docs.library.noDescription')}
        </Text>
      )}
    </Flexbox>
  );
});

LibraryHero.displayName = 'LibraryHero';

export default LibraryHero;
