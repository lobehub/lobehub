'use client';

import { Button, cssVar, Flexbox, Text } from '@lobehub/ui';
import { cssVar as vars } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { quickNoteSelectors, UNCATEGORIZED_KEY, useQuickNoteStore } from '@/store/quickNote';

import { buildFilterChips, type FilterChip } from './buildFilterChips';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    flex: 'none',
    maxWidth: 140,
    height: 24,
    paddingInline: 10,
    borderRadius: 12,
    fontSize: 12,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Overrides the text Button's own hover colors, so both states set them.
  chipActive: {
    color: { 'default': vars.colorBgContainer, ':hover': vars.colorBgContainer },
    backgroundColor: { 'default': vars.colorText, ':hover': vars.colorText },
  },
  chipCollection: {
    backgroundColor: vars.colorFillSecondary,
  },
  chipRow: {
    'scrollbarWidth': 'none',
    'overflowX': 'auto',
    'paddingInline': 12,
    'maskImage': 'linear-gradient(90deg, #000 calc(100% - 28px), transparent)',
    '::-webkit-scrollbar': { display: 'none' },
  },
  chipTag: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: vars.colorBorderSecondary,
  },
  count: {
    marginInlineStart: 4,
  },
});

const Chip = memo<{
  active: boolean;
  count?: number;
  label: string;
  variant: 'collection' | 'tag';
  onClick: () => void;
}>(({ active, count, label, variant, onClick }) => (
  <Button
    aria-pressed={active}
    data-active={active}
    size={'small'}
    type={'text'}
    {...stylex.props(
      styles.chip,
      variant === 'collection' ? styles.chipCollection : styles.chipTag,
      active && styles.chipActive,
    )}
    onClick={onClick}
  >
    {label}
    {count !== undefined && (
      <Text
        {...stylex.props(styles.count)}
        color={active ? cssVar.colorBgContainer : cssVar.colorTextTertiary}
        fontSize={12}
      >
        {count}
      </Text>
    )}
  </Button>
));

Chip.displayName = 'QuickNoteFilterChip';

const selectChip = (chip: FilterChip, setActiveCollection: (collection: string | null) => void) => {
  if (chip.onSelect === 'all') setActiveCollection(null);
  else if (chip.onSelect === 'uncategorized') setActiveCollection(UNCATEGORIZED_KEY);
  else setActiveCollection(chip.onSelect);
};

const FilterChips = memo(() => {
  const { t } = useTranslation('note');
  const [activeCollection, activeTag, setActiveCollection, setActiveTag] = useQuickNoteStore(
    (s) => [s.activeCollection, s.activeTag, s.setActiveCollection, s.setActiveTag],
  );
  const collections = useQuickNoteStore(quickNoteSelectors.collections, isEqual);
  const tags = useQuickNoteStore(quickNoteSelectors.tags, isEqual);
  const uncategorizedCount = useQuickNoteStore(quickNoteSelectors.uncategorizedCount);

  const { collectionChips, tagChips } = useMemo(
    () =>
      buildFilterChips({
        activeCollection,
        activeTag,
        allLabel: t('sidebar.allNotes'),
        collections,
        tags,
        uncategorizedCount,
        uncategorizedLabel: t('sidebar.uncategorized'),
      }),
    [activeCollection, activeTag, collections, t, tags, uncategorizedCount],
  );

  return (
    <Flexbox flex={'none'} gap={6} paddingBlock={8}>
      <Flexbox horizontal className={stylex.props(styles.chipRow).className} gap={6}>
        {collectionChips.map((chip) => (
          <Chip
            active={chip.active}
            count={chip.count}
            key={chip.key}
            label={chip.label}
            variant={'collection'}
            onClick={() => selectChip(chip, setActiveCollection)}
          />
        ))}
      </Flexbox>
      {tagChips.length > 0 && (
        <Flexbox horizontal className={stylex.props(styles.chipRow).className} gap={6}>
          {tagChips.map((chip) => (
            <Chip
              active={chip.active}
              count={chip.count}
              key={chip.key}
              label={chip.label}
              variant={'tag'}
              onClick={() => setActiveTag(activeTag === chip.onSelect ? null : chip.onSelect)}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

FilterChips.displayName = 'QuickNoteFilterChips';

export default FilterChips;
