'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { LayoutDashboardIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePathname } from '@/libs/router/navigation';
import { useEvalStore } from '@/store/eval';

import BenchmarkList from './BenchmarkList';
import ExperimentList from './ExperimentList';

const useActiveKey = () => {
  const pathname = usePathname();
  if (pathname === '/eval') return 'dashboard';

  const benchMatch = pathname.match(/\/eval\/bench\/([^/]+)/);
  if (benchMatch) return `bench-${benchMatch[1]}`;

  const experimentMatch = pathname.match(/\/eval\/experiments\/([^/]+)/);
  if (experimentMatch) return `experiment-${experimentMatch[1]}`;

  return 'dashboard';
};

const Body = memo(() => {
  const activeKey = useActiveKey();
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('eval');
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const useFetchExperiments = useEvalStore((s) => s.useFetchExperiments);
  useFetchBenchmarks();
  useFetchExperiments();

  return (
    <Flexbox gap={8} paddingInline={4}>
      <Flexbox gap={1}>
        <WorkspaceLink
          to="/eval"
          onClick={(e) => {
            e.preventDefault();
            navigate('/eval');
          }}
        >
          <NavItem
            active={activeKey === 'dashboard'}
            icon={LayoutDashboardIcon}
            title={t('sidebar.dashboard')}
          />
        </WorkspaceLink>
      </Flexbox>
      <Accordion defaultExpandedKeys={['benchmarks', 'experiments']} gap={8}>
        <ExperimentList activeKey={activeKey} itemKey="experiments" />
        <BenchmarkList activeKey={activeKey} itemKey="benchmarks" />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
