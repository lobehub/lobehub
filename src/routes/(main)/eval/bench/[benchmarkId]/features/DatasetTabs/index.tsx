'use client';

import { Empty } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
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
    <Tabs
      activeKey={activeDatasetId || datasets[0]?.id}
      items={datasets.map((d: any) => ({ key: d.id, label: d.name }))}
      onChange={onChange}
    />
  );
});

export default DatasetTabs;
