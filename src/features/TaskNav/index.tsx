'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ListTodoIcon, TargetIcon } from 'lucide-react';
import { type ComponentProps, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { projectIcon } from '@/features/HomeSidebar/Body/Project/ProjectItem';
import { ListHeader } from '@/features/MessageList';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import { NAV_PANEL_TASKS_KEY } from '@/features/NavPanel/railRouteKey';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useLoadedProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { isModifierClick } from '@/utils/navigation';

import { resolveTaskScope, taskScopeUrl } from './taskScope';

const styles = stylex.create({
  empty: {
    paddingBlock: '8px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
  sectionTitle: {
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
});

interface EntryProps {
  active: boolean;
  icon: ComponentProps<typeof NavItem>['icon'];
  title: string;
  url: string;
}

const Entry = memo<EntryProps>(({ active, icon, title, url }) => {
  const navigate = useWorkspaceAwareNavigate();

  return (
    <WorkspaceLink
      aria-current={active ? 'page' : undefined}
      aria-label={title}
      to={url}
      onClick={(e) => {
        if (isModifierClick(e)) return;
        e.preventDefault();
        navigate(url);
      }}
    >
      <NavItem active={active} icon={icon} title={title} />
    </WorkspaceLink>
  );
});

Entry.displayName = 'TaskNavEntry';

const Body = memo(() => {
  const { t } = useTranslation('common');
  const { pathname, search } = useActiveLocation();
  const activeSlug = useActiveWorkspaceSlug();
  const enableGoals = useUserStore(labPreferSelectors.enableGoals);
  const enableProjects = useUserStore(labPreferSelectors.enableProjects);
  const projects = useLoadedProjectList();
  useProjectStore((s) => s.useFetchProjectList)(enableProjects);

  const scope = resolveTaskScope(pathname, search ?? '', activeSlug);

  return (
    <Flexbox gap={1} paddingBlock={'0 12px'} paddingInline={6}>
      <Entry
        active={scope.type === 'all'}
        icon={ListTodoIcon}
        title={t('taskNav.all')}
        url={taskScopeUrl()}
      />
      {enableGoals && (
        <Entry
          active={scope.type === 'goals'}
          icon={TargetIcon}
          title={t('tab.goals')}
          url="/goals"
        />
      )}
      {enableProjects && (
        <>
          <div {...stylex.props(styles.sectionTitle)}>{t('tab.projects')}</div>
          {projects === undefined ? (
            <SkeletonList rows={3} />
          ) : projects.length === 0 ? (
            <div {...stylex.props(styles.empty)}>{t('taskNav.noProjects')}</div>
          ) : (
            projects.map((project) => (
              <Entry
                active={scope.type === 'project' && scope.projectId === project.id}
                icon={projectIcon(project)}
                key={project.id}
                title={project.name}
                url={taskScopeUrl(project.id)}
              />
            ))
          )}
        </>
      )}
    </Flexbox>
  );
});

Body.displayName = 'TaskNavBody';

const Header = memo(() => {
  const { t } = useTranslation('common');
  return <ListHeader title={t('tab.tasks')} />;
});

Header.displayName = 'TaskNavHeader';

/**
 * Tasks tab list column: every task, goals, then one entry per project. A
 * project entry scopes the task list in place (`/tasks?project=<id>`), so the
 * user stays in the Tasks tab instead of jumping into the project workbench.
 */
const TaskNavPortal = () => (
  <NavPanelPortal navKey={NAV_PANEL_TASKS_KEY}>
    <SideBarLayout body={<Body />} header={<Header />} />
  </NavPanelPortal>
);

export default TaskNavPortal;
