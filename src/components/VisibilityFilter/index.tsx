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
  onChange: (value: VisibilityFilterValue) => void;
  value: VisibilityFilterValue;
}

/**
 * The header filter of a workspace resource list that shows private and shared
 * rows together (devices, subscription accounts, environments, credentials).
 * It defaults to everything; the rows themselves carry the lock. Options carry
 * no counts: a count per option ignores the page's other filters, so the
 * page's own summary reports how many rows the filters leave instead.
 */
const VisibilityFilter = memo<VisibilityFilterProps>(({ onChange, value }) => {
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
            {t(`visibilityFilter.${option}`)}
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
