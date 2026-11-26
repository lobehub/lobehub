import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type SidebarVisibility } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { getAgentPublishErrorKey } from '@/features/AgentVisibility/publishError';
import { useRevealSidebarSection } from '@/features/HomeSidebar/hooks/useRevealSidebarSection';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

export type AgentVisibilityOption = 'private' | 'public';

/** Why the scope is shown but cannot be switched. */
export type AgentVisibilityLockReason = 'builtin' | 'notCreator';

interface UseAgentVisibilityControlParams {
  id: string;
  slug?: string | null;
  userId?: string | null;
  visibility?: SidebarVisibility;
}

export interface AgentVisibilityControl {
  /** Whether the viewer may switch this Agent between Private and Workspace. */
  canChange: boolean;
  /** The current scope; undefined outside a workspace or before the row loads. */
  current?: AgentVisibilityOption;
  /** Set when a workspace Agent's scope is visible but locked for this viewer. */
  lockReason?: AgentVisibilityLockReason;
  /** Confirm, then switch to `next`. Picking the current scope is a no-op. */
  select: (next: AgentVisibilityOption) => void;
}

/**
 * Agent visibility as a property: Private (only the creator) or Workspace.
 *
 * Who may switch is enforced by the server with the same rules: only inside a
 * workspace, never on builtin agents, a private Agent can be published by
 * whoever sees it (its creator), and a published Agent only goes back to
 * private by its creator — a workspace owner demoting someone else's Agent
 * would appropriate it.
 */
export const useAgentVisibilityControl = ({
  id,
  slug,
  userId,
  visibility,
}: UseAgentVisibilityControlParams): AgentVisibilityControl => {
  const { t } = useTranslation(['chat', 'common']);

  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const refreshWorkspaceUserPreference = useUserStore((s) => s.refreshWorkspaceUserPreference);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);
  const revealSidebarSection = useRevealSidebarSection();

  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', id);
  const canConfigure = canEdit && isAccessResolved && canEditResource;

  const isBuiltin = !!slug && BUILTIN_SLUGS.has(slug);
  const isCreator = !!currentUserId && userId === currentUserId;
  const current: AgentVisibilityOption | undefined = !activeWorkspaceId
    ? undefined
    : visibility === 'private'
      ? 'private'
      : visibility === 'public'
        ? 'public'
        : undefined;

  const lockReason: AgentVisibilityLockReason | undefined = !current
    ? undefined
    : isBuiltin
      ? 'builtin'
      : current === 'public' && !isCreator
        ? 'notCreator'
        : undefined;

  const canChange = !!current && canConfigure && !lockReason;

  // The settings page reads the Agent from the agent store, the sidebar from
  // the home list — refresh both so neither keeps the old scope.
  const refresh = useCallback(
    () => Promise.all([refreshAgentList(), refreshAgentConfig(id)]),
    [id, refreshAgentConfig, refreshAgentList],
  );

  const publish = useCallback(() => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('agent.publishToWorkspace'),
      onOk: async () => {
        try {
          await agentService.publishAgentToWorkspace(id);
          // Publishing moves a private pin into this member's personal pin
          // list server-side.
          await Promise.all([refresh(), refreshWorkspaceUserPreference()]);
          revealSidebarSection('agent');
          toast.success(t('agent.publishToWorkspaceSuccess'));
        } catch (error) {
          console.error('Failed to publish agent:', error);
          const publishErrorKey = getAgentPublishErrorKey(error);
          toast.error(
            publishErrorKey ? t(publishErrorKey) : t('operationFailed', { ns: 'common' }),
          );
        }
      },
      title: t('agent.publishToWorkspace'),
    });
  }, [id, refresh, refreshWorkspaceUserPreference, revealSidebarSection, t]);

  const makePrivate = useCallback(() => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: async () => {
        try {
          await agentService.setAgentVisibility(id, 'private');
          await refresh();
          revealSidebarSection('agent');
          toast.success(t('makePrivate.success', { ns: 'common' }));
        } catch (error) {
          console.error('Failed to make agent private:', error);
          toast.error(t('makePrivate.error', { ns: 'common' }));
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [id, refresh, revealSidebarSection, t]);

  const select = useCallback(
    (next: AgentVisibilityOption) => {
      if (!canChange || next === current) return;
      if (next === 'public') publish();
      else makePrivate();
    },
    [canChange, current, makePrivate, publish],
  );

  return { canChange, current, lockReason, select };
};
