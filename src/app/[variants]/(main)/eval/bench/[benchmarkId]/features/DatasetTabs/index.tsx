'use client';

import { Empty, Segmented } from '@lobehub/ui';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface DatasetTabsProps {
  activeDatasetId?: string;
  datasets: any[];
  onChange: (datasetId: string) => void;
}

const DatasetTabs = memo<DatasetTabsProps>(({ datasets, activeDatasetId, onChange }) => {
  const { t } = useTranslation('eval');

  if (datasets.length === 0) {
    return <Empty description={t('dataset.empty')} icon={Database} />;
  }

  return (
    <Segmented
      onChange={(value) => onChange(value as string)}
      options={datasets.map((d: any) => ({ label: d.name, value: d.id }))}
      value={activeDatasetId || datasets[0]?.id}
    />
  );
});

export default DatasetTabs;
