'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { quickNoteSelectors, UNCATEGORIZED_KEY, useQuickNoteStore } from '@/store/quickNote';

import { buildFilterChips, type FilterChip } from './buildFilterChips';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    overflow: hidden;
    flex: none;

    max-width: 140px;
    height: 24px;
    padding-inline: 10px;
    border-radius: 12px;

    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  chipActive: css`
    &&,
    &&:hover {
      color: ${cssVar.colorBgContainer};
      background: ${cssVar.colorText};
    }
  `,
  chipCollection: css`
    background: ${cssVar.colorFillSecondary};
  `,
  chipRow: css`
    scrollbar-width: none;
    overflow-x: auto;
    padding-inline: 12px;

    mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  chipTag: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  count: css`
    margin-inline-start: 4px;
  `,
}));

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
    className={cx(
      styles.chip,
      variant === 'collection' ? styles.chipCollection : styles.chipTag,
      active && styles.chipActive,
    )}
    onClick={onClick}
  >
    {label}
    {count !== undefined && (
      <Text
        className={styles.count}
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
      <Flexbox horizontal className={styles.chipRow} gap={6}>
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
        <Flexbox horizontal className={styles.chipRow} gap={6}>
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
