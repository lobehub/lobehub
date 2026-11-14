'use client';

import { ActionIcon, Checkbox, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { isDeletableItem, type StorageAnalysisItem, type StorageCategory } from './analysis';
import { CATEGORY_COLORS, CATEGORY_ICONS } from './categoryMeta';

const styles = stylex.create({
  item: {
    borderRadius: cssVar.borderRadius,
    paddingBlock: 6,
    paddingInline: 8,
  },
  itemHover: {
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
  path: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  section: {
    borderTopColor: cssVar.colorBorderSecondary,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    paddingBlock: 12,
  },
  size: {
    flex: 'none',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'end',
    width: 88,
  },
  swatch: {
    borderRadius: 2,
    flex: 'none',
    height: 10,
    width: 10,
  },
  swatchColor: (color: string) => ({ backgroundColor: color }),
});

interface CategorySectionProps {
  bytes: number;
  category: StorageCategory;
  /** How many items the category holds in all; the list shows the largest. */
  itemCount: number;
  items: StorageAnalysisItem[];
  onToggle: (items: StorageAnalysisItem[], selected: boolean) => void;
  selected: Set<string>;
}

/**
 * One category of the analysis: what it is, what it occupies, and its largest
 * items to tick one by one — or all at once from the category's own box.
 * Environment snapshots are listed for what they occupy and nothing more:
 * they go with their environment, on the environments page.
 */
const CategorySection = memo<CategorySectionProps>(
  ({ bytes, category, itemCount, items, onToggle, selected }) => {
    const { t } = useTranslation('setting');
    const [open, setOpen] = useState(category === 'dependencies' || category === 'cache');
    const deletable = items.filter(isDeletableItem);
    const selectedCount = deletable.filter((item) => selected.has(item.path)).length;
    const all = deletable.length > 0 && selectedCount === deletable.length;

    return (
      <Flexbox gap={8} {...stylex.props(styles.section)}>
        <Flexbox horizontal align={'center'} gap={10}>
          {deletable.length > 0 ? (
            <Checkbox
              checked={all}
              indeterminate={selectedCount > 0 && !all}
              onChange={(checked) => onToggle(deletable, checked)}
            />
          ) : (
            <span style={{ flex: 'none', width: 16 }} />
          )}
          <span {...stylex.props(styles.swatch, styles.swatchColor(CATEGORY_COLORS[category]))} />
          <Icon icon={CATEGORY_ICONS[category]} size={16} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Text weight={500}>{t(`drive.cleanup.category.${category}`)}</Text>
              {(category === 'dependencies' || category === 'cache') && (
                <Tag color={'success'} size={'small'}>
                  {t('drive.cleanup.regenerable')}
                </Tag>
              )}
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {t(`drive.cleanup.categoryHint.${category}`)}
            </Text>
          </Flexbox>
          <Text {...stylex.props(styles.size)} weight={500}>
            {formatSize(bytes)}
          </Text>
          <ActionIcon
            disabled={items.length === 0}
            icon={open ? ChevronDownIcon : ChevronRightIcon}
            size={'small'}
            title={t(open ? 'drive.cleanup.collapse' : 'drive.cleanup.expand')}
            onClick={() => setOpen(!open)}
          />
        </Flexbox>
        {open && items.length > 0 && (
          <Flexbox gap={2} style={{ paddingInlineStart: 26 }}>
            {items.map((item) => {
              const canDelete = isDeletableItem(item);
              const checked = selected.has(item.path);
              return (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={10}
                  key={item.path}
                  {...stylex.props(styles.item, canDelete && styles.itemHover)}
                >
                  {canDelete ? (
                    <Checkbox checked={checked} onChange={(next) => onToggle([item], next)} />
                  ) : (
                    <span style={{ flex: 'none', width: 16 }} />
                  )}
                  <Text {...stylex.props(styles.path)} title={item.path} type={'secondary'}>
                    {item.path}
                  </Text>
                  <span style={{ flex: 1 }} />
                  <Text {...stylex.props(styles.size)} fontSize={12} type={'secondary'}>
                    {formatSize(item.bytes)}
                  </Text>
                </Flexbox>
              );
            })}
            {itemCount > items.length && (
              <Text fontSize={12} style={{ paddingInline: 8 }} type={'secondary'}>
                {t('drive.cleanup.moreItems', { count: itemCount - items.length })}
              </Text>
            )}
            {category === 'environments' && (
              <Text fontSize={12} style={{ paddingInline: 8 }} type={'secondary'}>
                {t('drive.cleanup.environmentsHint')}
              </Text>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

CategorySection.displayName = 'StorageCleanupCategorySection';

export default CategorySection;
