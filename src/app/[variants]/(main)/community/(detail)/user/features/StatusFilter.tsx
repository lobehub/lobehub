'use client';

import { Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export type StatusFilterValue = 'published' | 'unpublished' | 'deprecated' | 'archived' | 'forked' | 'favorite';

interface StatusFilterProps {
  onChange: (value: StatusFilterValue) => void;
  value: StatusFilterValue;
}

const StatusFilter = memo<StatusFilterProps>(({ value, onChange }) => {
  const { t } = useTranslation('discover');

  const options = [
    { label: t('user.statusFilter.published'), value: 'published' as const },
    { label: t('user.statusFilter.unpublished'), value: 'unpublished' as const },
    { label: t('user.statusFilter.deprecated'), value: 'deprecated' as const },
    { label: t('user.statusFilter.archived'), value: 'archived' as const },
    { label: t('user.statusFilter.forked'), value: 'forked' as const },
    { label: t('user.statusFilter.favorite'), value: 'favorite' as const },
  ];

  return (
    <Select
      onChange={onChange}
      options={options}
      style={{ minWidth: 120 }}
      value={value}
    />
  );
});

export default StatusFilter;
