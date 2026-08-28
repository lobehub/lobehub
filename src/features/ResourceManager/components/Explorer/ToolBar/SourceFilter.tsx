'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  canFilterResourceSource,
  getResourceSourceFilter,
} from '@/features/ResourceManager/store/selectors';
import { ResourceSourceFilter } from '@/types/files';

const styles = createStaticStyles(({ css }) => ({
  option: css`
    flex: none;

    height: 24px;
    padding-inline: 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  optionActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
}));

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
            className={cx(styles.option, isActive && styles.optionActive)}
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
