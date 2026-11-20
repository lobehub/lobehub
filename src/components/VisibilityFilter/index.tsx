'use client';

import { Flexbox, Icon, Select } from '@lobehub/ui';
import { LayersIcon, LockIcon, type LucideIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { VISIBILITY_FILTER_VALUES, type VisibilityFilterValue } from './filter';

export { matchesVisibilityFilter, type VisibilityFilterValue } from './filter';

const ICONS: Record<VisibilityFilterValue, LucideIcon> = {
  all: LayersIcon,
  private: LockIcon,
  workspace: UsersIcon,
};

interface VisibilityFilterProps {
  /** Rows per option, shown beside its label. */
  counts?: Record<VisibilityFilterValue, number>;
  onChange: (value: VisibilityFilterValue) => void;
  value: VisibilityFilterValue;
}

/**
 * The header filter of a workspace resource list that shows private and shared
 * rows together (devices, subscription accounts, environments, credentials).
 * It defaults to everything; the rows themselves carry the lock.
 */
const VisibilityFilter = memo<VisibilityFilterProps>(({ counts, onChange, value }) => {
  const { t } = useTranslation('common');

  return (
    <Select
      aria-label={t('visibilityFilter.label')}
      style={{ minWidth: 140 }}
      value={value}
      variant={'filled'}
      options={VISIBILITY_FILTER_VALUES.map((option) => ({
        label: (
          <Flexbox horizontal align={'center'} gap={6}>
            <Icon icon={ICONS[option]} size={14} />
            {counts
              ? `${t(`visibilityFilter.${option}`)} · ${counts[option]}`
              : t(`visibilityFilter.${option}`)}
          </Flexbox>
        ),
        value: option,
      }))}
      onChange={(next) => onChange(next as VisibilityFilterValue)}
    />
  );
});

VisibilityFilter.displayName = 'VisibilityFilter';

export default VisibilityFilter;
