import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import type { ProjectDetail } from '@/store/project';

import { openAddKnowledgeBaseModal } from '../KnowledgeBases/AddKnowledgeBaseModal';
import { getProjectGoalsPath, getProjectSettingsPath } from '../Layout/navigation';
import { openSiteModal } from '../Review/SiteFormModal';
import { useCanManageProject } from '../useCanManageProject';
import { openAddDirectoryModal } from '../WorkingDirectories/AddDirectoryModal';
import type { OnboardingConnection } from './steps';

export const WORKSPACE_MEMBERS_PATH = '/settings/members';

export const useOnboardingCardAllowed = (projectId: string) => {
  const dismissed = useGlobalStore(systemStatusSelectors.projectOnboardingDismissed(projectId));
  const canManage = useCanManageProject();
  return canManage && !dismissed;
};

export const useOnboardingActions = (detail: ProjectDetail, refreshSites: () => void) => {
  const navigate = useWorkspaceAwareNavigate();
  const { project } = detail;
  const routeId = project.slug ?? project.id;
  const isShared = Boolean(project.workspaceId) && project.visibility === 'public';

  const openConnection = (item: OnboardingConnection) => {
    switch (item.key) {
      case 'directory': {
        if (item.done) navigate(getProjectSettingsPath(routeId, 'directories'));
        else openAddDirectoryModal(project.id);
        return;
      }
      case 'site': {
        if (item.site === 'none') openSiteModal({ onSaved: refreshSites, projectId: project.id });
        else navigate(getProjectSettingsPath(routeId, 'sites'));
        return;
      }
      case 'knowledge': {
        if (item.done) {
          navigate(getProjectSettingsPath(routeId, 'knowledge'));
          return;
        }
        openAddKnowledgeBaseModal({
          existingIds: (detail.knowledgeBases ?? []).map((kb) => kb.knowledgeBase.id),
          projectId: project.id,
          visibility: isShared ? 'public' : undefined,
        });
        return;
      }
      case 'goal': {
        navigate(getProjectGoalsPath(routeId));
      }
    }
  };

  return {
    inviteMembers: () => navigate(WORKSPACE_MEMBERS_PATH),
    openConnection,
  };
};
