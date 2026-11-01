'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import LibraryStatusIcon from '@/components/LibIcon/StatusIcon';
import LibraryCover, { libraryCoverOf } from '@/features/LibraryCover';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

export const libraryCardStyles = stylex.create({
  card: {
    cursor: 'pointer',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    textAlign: 'start',
    backgroundColor: cssVar.colorBgContainer,
    boxShadow: { 'default': 'none', ':hover': cssVar.boxShadowTertiary },
    transitionProperty: 'border-color, box-shadow',
    transitionDuration: '0.2s',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
  createCard: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '196px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorTextQuaternary },
    borderRadius: cssVar.borderRadiusLG,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
    opacity: { 'default': 1, ':disabled': 0.5 },
    transitionProperty: 'border-color, color',
    transitionDuration: '0.2s',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
  description: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    minHeight: '40px',
    fontSize: '13px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
  name: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const styles = libraryCardStyles;

interface LibraryCardProps {
  library: KnowledgeBaseItem;
  onOpen: (id: string) => void;
}

/** A library as a cover card: cover, name, description, visibility and last update. */
export const LibraryCard = memo<LibraryCardProps>(({ library, onOpen }) => {
  const { t } = useTranslation('file');

  return (
    <button type={'button'} {...stylex.props(styles.card)} onClick={() => onOpen(library.id)}>
      <LibraryCover cover={libraryCoverOf(library.settings)} height={88} seed={library.id} />
      <Flexbox gap={6} paddingBlock={12} paddingInline={14} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={6}>
          <LibraryStatusIcon
            memberRestricted={(library as { memberRestricted?: boolean }).memberRestricted}
            size={16}
            visibility={library.visibility}
          />
          <span {...stylex.props(styles.name)}>{library.name}</span>
        </Flexbox>
        <div {...stylex.props(styles.description)}>
          {library.description || t('docs.library.noDescription')}
        </div>
        <Text fontSize={12} type={'secondary'}>
          {t('docs.library.updatedAt', { time: dayjs(library.updatedAt).fromNow() })}
        </Text>
      </Flexbox>
    </button>
  );
});

LibraryCard.displayName = 'LibraryCard';

interface CreateLibraryCardProps {
  disabled?: boolean;
  onCreate: () => void;
}

export const CreateLibraryCard = memo<CreateLibraryCardProps>(({ disabled, onCreate }) => {
  const { t } = useTranslation('file');

  return (
    <button
      disabled={disabled}
      type={'button'}
      {...stylex.props(styles.createCard)}
      onClick={onCreate}
    >
      <Icon icon={PlusIcon} size={20} />
      {t('library.new')}
    </button>
  );
});

CreateLibraryCard.displayName = 'CreateLibraryCard';
