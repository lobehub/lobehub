'use client';

import { AccordionRoot, Flexbox } from '@lobehub/ui';
import { LayoutDashboard } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { benchmarkHomePath } from '@/features/LobeBench/experimentNavigation';
import { useIsLobeBenchBenchmark } from '@/features/LobeBench/useIsLobeBenchBenchmark';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import DatasetList from './DatasetList';
import RunList from './RunList';
import { useActiveBenchmarkSidebarRoute } from './useActiveBenchmarkSidebarRoute';

const Body = memo(() => {
  const { t } = useTranslation('eval');
  const { activeKey, benchmarkId } = useActiveBenchmarkSidebarRoute();
  const navigate = useWorkspaceAwareNavigate();
  // A Lobe Bench run opens here; its dashboard is Lobe Bench's benchmark page.
  const lobeBench = useIsLobeBenchBenchmark(benchmarkId);
  const dashboardPath = benchmarkHomePath(benchmarkId || '', lobeBench);

  return (
    <Flexbox gap={8} paddingInline={4}>
      <Flexbox paddingInline={4}>
        <WorkspaceLink
          to={dashboardPath}
          onClick={(e) => {
            e.preventDefault();
            navigate(dashboardPath);
          }}
        >
          <NavItem
            active={activeKey === 'overview'}
            icon={LayoutDashboard}
            iconSize={16}
            title={t('sidebar.dashboard')}
          />
        </WorkspaceLink>
      </Flexbox>
      <AccordionRoot
        defaultValue={['datasets', 'runs']}
        indicatorPlacement="inline"
        style={{ gap: 8 }}
      >
        <DatasetList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="datasets" />
        <RunList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="runs" />
      </AccordionRoot>
    </Flexbox>
  );
});

export default Body;
