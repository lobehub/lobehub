'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { LayoutDashboard } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

  return (
    <Flexbox gap={8} paddingInline={4}>
      <Flexbox paddingInline={4}>
        <WorkspaceLink
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
        </WorkspaceLink>
      </Flexbox>
      <Accordion defaultExpandedKeys={['datasets', 'runs']} gap={8}>
        <DatasetList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="datasets" />
        <RunList activeKey={activeKey} benchmarkId={benchmarkId || ''} itemKey="runs" />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
