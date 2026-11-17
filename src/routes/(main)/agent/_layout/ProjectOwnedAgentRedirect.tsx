import { toast } from '@lobehub/ui';
import { type PropsWithChildren, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';

import { resolveCoordinatorRedirect } from '@/features/Projects/CoordinatorSettings/views';
import { getProjectCoordinatorSettingsPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';

/**
 * The project an agent belongs to (`agents.owner_project_id`), once its config
 * has loaded. `undefined` for standalone agents and while loading.
 */
export const useAgentOwnerProjectId = (agentId?: string) =>
  useAgentStore((s) => (agentId ? (s.agentMap[agentId]?.ownerProjectId ?? undefined) : undefined));

/**
 * A project's own main agent is configured only in the project settings
 * (design T-14322 §f.2). Its `/agent/:aid/<settings>` pages — profile,
 * instruction, engine, tools, skills, knowledge, environment, IM channels —
 * redirect there with a one-off notice, so the agent side never offers a
 * second copy of the same configuration. The conversation, topics and tasks
 * keep their agent URLs, so IM callbacks, notifications and history links
 * still land.
 */
const ProjectOwnedAgentRedirect = ({ children }: PropsWithChildren) => {
  const { t } = useTranslation('project');
  const { aid } = useParams<{ aid?: string }>();
  const { pathname } = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const ownerProjectId = useAgentOwnerProjectId(aid);
  const target = useMemo(
    () => (ownerProjectId ? resolveCoordinatorRedirect(pathname) : undefined),
    [ownerProjectId, pathname],
  );

  useEffect(() => {
    if (!ownerProjectId || !target) return;
    navigate(getProjectCoordinatorSettingsPath(ownerProjectId, target), { replace: true });
    toast.info(t('coordinator.redirectedFromAgentSettings'));
  }, [navigate, ownerProjectId, t, target]);

  // Never paint the agent-side editor for a project-owned agent, even for a frame.
  if (target) return null;
  return children;
};

export default ProjectOwnedAgentRedirect;
