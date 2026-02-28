'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useEvalStore } from '@/store/eval';

interface DatasetListProps {
  activeKey: string;
  benchmarkId: string;
  itemKey: string;
}

const DatasetList = memo<DatasetListProps>(({ activeKey, benchmarkId, itemKey }) => {
  const { t } = useTranslation('eval');
  const navigate = useNavigate();
  const datasetList = useEvalStore((s) => s.datasetList);
  const isLoading = useEvalStore((s) => s.isLoadingDatasets);

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('sidebar.datasets')}
          </Text>
          {datasetList.length > 0 && (
            <Text fontSize={11} type="secondary">
              {datasetList.length}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {isLoading && datasetList.length === 0 ? (
          <SkeletonList rows={3} />
        ) : datasetList.length > 0 ? (
          datasetList.map((ds: any) => (
            <Link
              key={ds.id}
              to={`/eval/bench/${benchmarkId}/datasets/${ds.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/eval/bench/${benchmarkId}/datasets/${ds.id}`);
              }}
            >
              <NavItem
                active={activeKey === `dataset-${ds.id}`}
                icon={Database}
                iconSize={16}
                title={ds.name}
              />
            </Link>
          ))
        ) : (
          <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
            {t('dataset.empty')}
          </Text>
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default DatasetList;
