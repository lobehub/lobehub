'use client';

import { AccordionItem, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';
import { isModifierClick } from '@/utils/navigation';

interface DatasetListProps {
  activeKey: string;
  itemKey: string;
}

/**
 * Every dataset, not only the ones under a benchmark. A dataset need not belong
 * to one, and every other listing in the product is benchmark-scoped — without
 * this a captured dataset could be created but never found.
 */
const DatasetList = memo<DatasetListProps>(({ activeKey, itemKey }) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const useFetchAllDatasets = useEvalStore((s) => s.useFetchAllDatasets);
  const { data, isLoading } = useFetchAllDatasets();
  const datasets: Array<{ id: string; name: string }> = data ?? [];

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
          {datasets.length > 0 && (
            <Text fontSize={12} type="secondary">
              {datasets.length}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {isLoading ? (
          <SkeletonList rows={2} />
        ) : datasets.length > 0 ? (
          datasets.map((d) => (
            <WorkspaceLink
              key={d.id}
              to={`/eval/datasets/${d.id}`}
              onClick={(e) => {
                if (isModifierClick(e)) return;
                e.preventDefault();
                navigate(`/eval/datasets/${d.id}`);
              }}
            >
              <NavItem
                active={activeKey === `dataset-${d.id}`}
                icon={Database}
                iconSize={16}
                title={d.name}
              />
            </WorkspaceLink>
          ))
        ) : (
          <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
            {t('sidebar.datasetsEmpty')}
          </Text>
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default DatasetList;
