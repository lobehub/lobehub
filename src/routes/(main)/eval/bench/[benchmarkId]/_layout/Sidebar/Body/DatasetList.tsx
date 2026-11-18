'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { Database } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { benchmarkDatasetPath } from '@/features/LobeBench/experimentNavigation';
import { useIsLobeBenchBenchmark } from '@/features/LobeBench/useIsLobeBenchBenchmark';
import NavItem from '@/features/NavPanel/components/NavItem';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { datasetSelectors, useEvalStore } from '@/store/eval';

interface DatasetListProps {
  activeKey: string;
  benchmarkId: string;
  itemKey: string;
}

const DatasetList = memo<DatasetListProps>(({ activeKey, benchmarkId, itemKey }) => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const datasetList = useEvalStore(datasetSelectors.datasetList(benchmarkId));
  const isLoading = useEvalStore(datasetSelectors.isLoadingDatasetList(benchmarkId));
  const lobeBench = useIsLobeBenchBenchmark(benchmarkId);

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader style={sectionTriggerStyle}>
        <AccordionTrigger>
          <Flexbox horizontal align="center" gap={4}>
            <SectionTitle>{t('sidebar.datasets')}</SectionTitle>
            {datasetList.length > 0 && (
              <Text fontSize={12} type="secondary">
                {datasetList.length}
              </Text>
            )}
          </Flexbox>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionPanel>
        <Flexbox gap={1} paddingBlock={1}>
          {isLoading && datasetList.length === 0 ? (
            <SkeletonList rows={3} />
          ) : datasetList.length > 0 ? (
            datasetList.map((ds: any) => (
              <WorkspaceLink
                key={ds.id}
                to={benchmarkDatasetPath(ds.id, lobeBench)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(benchmarkDatasetPath(ds.id, lobeBench));
                }}
              >
                <NavItem
                  active={activeKey === `dataset-${ds.id}`}
                  icon={Database}
                  iconSize={16}
                  title={ds.name}
                />
              </WorkspaceLink>
            ))
          ) : (
            <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
              {t('dataset.empty')}
            </Text>
          )}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
});

export default DatasetList;
