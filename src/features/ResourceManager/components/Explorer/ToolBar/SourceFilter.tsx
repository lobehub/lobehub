'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  canFilterResourceSource,
  getResourceSourceFilter,
} from '@/features/ResourceManager/store/selectors';
import { ResourceSourceFilter } from '@/types/files';

const styles = stylex.create({
  option: {
    flex: 'none',
    height: '24px',
    paddingInline: '10px',
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  optionActive: {
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

const OPTIONS: Array<{ key: ResourceSourceFilter; labelKey: string }> = [
  { key: ResourceSourceFilter.All, labelKey: 'FileManager.source.all' },
  { key: ResourceSourceFilter.Generated, labelKey: 'FileManager.source.generated' },
  { key: ResourceSourceFilter.Uploaded, labelKey: 'FileManager.source.uploaded' },
  { key: ResourceSourceFilter.Acceptance, labelKey: 'FileManager.source.acceptance' },
];

/**
 * Origin chips for the explorer list: All / AI generated / Uploaded /
 * Acceptance. Sits on the item-count row so the count and the pool it counts
 * read as one statement.
 *
 * Renders nothing where origin is meaningless (inside a library, on Pages or
 * Home) — see `canFilterResourceSource`.
 */
const SourceFilter = memo(() => {
  const { t } = useTranslation('components');
  const [canFilter, activeFilter, setSourceFilter] = useResourceManagerStore((s) => [
    canFilterResourceSource(s),
    getResourceSourceFilter(s),
    s.setSourceFilter,
  ]);

  if (!canFilter) return null;

  return (
    <Flexbox horizontal align={'center'} gap={2}>
      {OPTIONS.map((option) => {
        const isActive = activeFilter === option.key;

        return (
          <Button
            aria-pressed={isActive}
            className={stylex.props(styles.option, isActive && styles.optionActive).className}
            key={option.key}
            size={'small'}
            type={'text'}
            onClick={() => setSourceFilter(option.key)}
          >
            {t(option.labelKey as never)}
          </Button>
        );
      })}
    </Flexbox>
  );
});

SourceFilter.displayName = 'SourceFilter';

export default SourceFilter;
