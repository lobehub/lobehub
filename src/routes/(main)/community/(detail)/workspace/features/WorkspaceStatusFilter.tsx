'use client';

import { Select } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceMarketStatusFilterValue } from './filterWorkspaceMarketItems';

interface WorkspaceStatusFilterProps {
  onChange: (value: WorkspaceMarketStatusFilterValue) => void;
  value: WorkspaceMarketStatusFilterValue;
}

const WorkspaceStatusFilter = memo<WorkspaceStatusFilterProps>(({ value, onChange }) => {
  const { t } = useTranslation('discover');

  const options = [
    { label: t('user.statusFilter.published'), value: 'published' as const },
    { label: t('user.statusFilter.unpublished'), value: 'unpublished' as const },
    { label: t('user.statusFilter.deprecated'), value: 'deprecated' as const },
    { label: t('user.statusFilter.archived'), value: 'archived' as const },
  ];

  return <Select options={options} style={{ minWidth: 120 }} value={value} onChange={onChange} />;
});

export default WorkspaceStatusFilter;
