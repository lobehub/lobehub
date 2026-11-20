import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { type SidebarVisibility } from '@lobechat/types';
import { confirmModal, type DropdownItem, Icon, toast } from '@lobehub/ui';
import { GlobeIcon, LockIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { agentService } from '@/services/agent';
import { useHomeStore } from '@/store/home';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useRevealSidebarSection } from '../../../../hooks';
import { getAgentPublishErrorKey } from './agentMenuVisibility';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

type AgentVisibilityOption = 'private' | 'public';

interface UseAgentVisibilityMenuParams {
  id: string;
  slug?: string | null;
  userId?: string | null;
  visibility?: SidebarVisibility;
}

export interface AgentVisibilityMenu {
  /** Whether the viewer may switch this Agent between Private and Workspace. */
  canChange: boolean;
  /** The two scope options, the current one checked. Empty when `canChange` is false. */
  options: DropdownItem[];
  /** The "Visibility" row for the Agent menu, carrying the current value. */
  submenu: DropdownItem | null;
}

/**
 * Agent visibility as a property rather than a one-way action: the menu row
 * shows the current scope, and the same two options open from the row's lock.
 *
 * Who may switch is unchanged from the old Publish / Make private actions, and
 * the server enforces the same rules: only inside a workspace, never on builtin
 * agents, a private Agent can be published by whoever sees it (its creator),
 * and a published Agent only goes back to private by its creator — a workspace
 * owner demoting someone else's Agent would appropriate it.
 */
export const useAgentVisibilityMenu = ({
  id,
  slug,
  userId,
  visibility,
}: UseAgentVisibilityMenuParams): AgentVisibilityMenu => {
  const { t } = useTranslation(['chat', 'common']);

  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const refreshWorkspaceUserPreference = useUserStore((s) => s.refreshWorkspaceUserPreference);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const revealSidebarSection = useRevealSidebarSection();

  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', id);
  const canConfigure = canEdit && isAccessResolved && canEditResource;

  const isBuiltin = !!slug && BUILTIN_SLUGS.has(slug);
  const isCreator = !!currentUserId && userId === currentUserId;
  const current: AgentVisibilityOption | undefined =
    visibility === 'private' ? 'private' : visibility === 'public' ? 'public' : undefined;

  const canChange =
    Boolean(activeWorkspaceId) &&
    canConfigure &&
    !isBuiltin &&
    (current === 'private' || (current === 'public' && isCreator));

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
          await Promise.all([refreshAgentList(), refreshWorkspaceUserPreference()]);
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
  }, [id, refreshAgentList, refreshWorkspaceUserPreference, revealSidebarSection, t]);

  const makePrivate = useCallback(() => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: async () => {
        try {
          await agentService.setAgentVisibility(id, 'private');
          await refreshAgentList();
          revealSidebarSection('agent');
          toast.success(t('makePrivate.success', { ns: 'common' }));
        } catch (error) {
          console.error('Failed to make agent private:', error);
          toast.error(t('makePrivate.error', { ns: 'common' }));
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [id, refreshAgentList, revealSidebarSection, t]);

  return useMemo(() => {
    if (!canChange || !current) return { canChange: false, options: [], submenu: null };

    const option = (
      value: AgentVisibilityOption,
      icon: typeof LockIcon,
      onSelect: () => void,
    ): DropdownItem => {
      const checked = current === value;

      // A checkbox item puts the check on the right of the scope icon and
      // keeps the menu eligible for the native desktop context menu.
      return {
        checked,
        // Base UI keeps checkbox menus open by default; a scope pick is final.
        closeOnClick: true,
        desc: t(
          value === 'private' ? 'agent.visibility.privateDesc' : 'agent.visibility.workspaceDesc',
        ),
        icon,
        key: `visibility-${value}`,
        label: t(value === 'private' ? 'agent.visibility.private' : 'agent.visibility.workspace'),
        // Picking the current scope is a no-op, not a second confirmation.
        onCheckedChange: (next: boolean) => {
          if (next && !checked) onSelect();
        },
        type: 'checkbox',
      } as DropdownItem;
    };

    const options = [
      option('private', LockIcon, makePrivate),
      option('public', GlobeIcon, publish),
    ];

    const submenu = {
      children: options,
      // The current value sits in the row, so the reader does not need to
      // open the submenu to learn which scope the Agent is in.
      extra: t(current === 'private' ? 'agent.visibility.private' : 'agent.visibility.workspace'),
      icon: <Icon icon={current === 'private' ? LockIcon : GlobeIcon} />,
      key: 'visibility',
      label: t('agent.visibility'),
      sfSymbol: current === 'private' ? 'lock' : 'globe',
    } as DropdownItem;

    return { canChange: true, options, submenu };
  }, [canChange, current, makePrivate, publish, t]);
};
