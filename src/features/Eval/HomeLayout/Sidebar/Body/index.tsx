'use client';

import { Flexbox } from '@lobehub/ui';
import { AccordionRoot } from '@lobehub/ui/base-ui';
import { LayoutDashboardIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import BenchmarkList from './BenchmarkList';
import DatasetList from './DatasetList';
import ExperimentList from './ExperimentList';
import { getActiveEvalHref } from './getActiveEvalHref';

const Body = () => {
  const { pathname } = useActiveLocation();
  const activeHref = getActiveEvalHref(pathname);
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation('eval');

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
            active={activeHref === '/eval'}
            icon={LayoutDashboardIcon}
            title={t('sidebar.dashboard')}
          />
        </WorkspaceLink>
      </Flexbox>
      <AccordionRoot
        defaultValue={['benchmarks', 'datasets', 'experiments']}
        indicatorPlacement="inline"
        style={{ gap: 8 }}
      >
        <BenchmarkList activeHref={activeHref} itemKey="benchmarks" />
        <DatasetList activeHref={activeHref} itemKey="datasets" />
        <ExperimentList activeHref={activeHref} itemKey="experiments" />
      </AccordionRoot>
    </Flexbox>
  );
};

export default Body;
