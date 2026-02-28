'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { LayoutDashboard } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { usePathname } from '@/libs/router/navigation';
import { useEvalStore } from '@/store/eval';

import DatasetList from './DatasetList';
import RunList from './RunList';

const useActiveKey = () => {
  const pathname = usePathname();

  const datasetMatch = pathname.match(/\/eval\/bench\/[^/]+\/datasets\/([^/]+)/);
  if (datasetMatch) return `dataset-${datasetMatch[1]}`;

  const runMatch = pathname.match(/\/eval\/bench\/[^/]+\/runs\/([^/]+)/);
  if (runMatch) return `run-${runMatch[1]}`;

  // Overview page: /eval/bench/{id} with no sub-route
  const isOverview = /\/eval\/bench\/[^/]+\/?$/.test(pathname);
  if (isOverview) return 'overview';

  return '';
};

const Body = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId } = useParams<{ benchmarkId: string }>();
  const navigate = useNavigate();
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const useFetchRuns = useEvalStore((s) => s.useFetchRuns);

  useFetchDatasets(benchmarkId);
  useFetchRuns(benchmarkId);

  const activeKey = useActiveKey();

  return (
    <Flexbox gap={8} paddingInline={4}>
      <Flexbox paddingInline={4}>
        <Link
          to={`/eval/bench/${benchmarkId}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/eval/bench/${benchmarkId}`);
          }}
        >
          <NavItem
            active={activeKey === 'overview'}
            icon={LayoutDashboard}
            iconSize={16}
            title={t('sidebar.dashboard')}
          />
        </Link>
      </Flexbox>
      <Accordion defaultExpandedKeys={['datasets', 'runs']} gap={8}>
        <DatasetList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="datasets" />
        <RunList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="runs" />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
