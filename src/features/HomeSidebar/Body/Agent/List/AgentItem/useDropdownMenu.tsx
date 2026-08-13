import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import {
  SessionDefaultGroup,
  type SidebarAgentLabel,
  type SidebarVisibility,
} from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import {
  Check,
  EyeOffIcon,
  FolderInputIcon,
  GlobeIcon,
  LucideCopy,
  LucidePlus,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  Settings2Icon,
  TagIcon,
  Trash,
  UsersIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentTransferMenuItem } from '@/business/client/hooks/useAgentTransferMenuItem';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { useOptionalAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { agentService } from '@/services/agent';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { agentLabelSelectors, homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';

import { useRevealSidebarSection } from '../../../../hooks';
import { useSidebarItemVisibility } from '../../useSidebarItemVisibility';
import { getAgentPublishErrorKey } from './agentMenuVisibility';

const BUILTIN_SLUGS = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

interface UseAgentDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  backgroundColor?: string;
  group: string | undefined;
  id: string;
  /** Labels currently applied to the agent (from the sidebar list payload). */
  labels?: SidebarAgentLabel[];
  /**
   * Show the Labels submenu. Off by default: the sidebar renders no label
   * badges, so tagging there has no visible feedback — the submenu only
   * surfaces on the agents list page (ItemActions), where labels render.
   */
  labelsEnabled?: boolean;
  openCreateGroupModal: () => void;
  pinned: boolean;
  slug?: string | null;
  title: string;
  userId?: string | null;
  visibility?: SidebarVisibility;
}

export const useAgentDropdownMenu = ({
  anchor,
  avatar,
  backgroundColor,
  group,
  id,
  labels,
  labelsEnabled,
  openCreateGroupModal,
  pinned,
  slug,
  title,
  userId,
  visibility,
}: UseAgentDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation(['chat', 'common', 'setting']);
  const navigate = useWorkspaceAwareNavigate();

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  // Pick the group bucket that matches this agent's visibility so the
  // "Move to group" picker only offers same-scope targets — moving a private
  // agent into a public group (or vice versa) would orphan it from the view
  // it currently lives in.
  const sessionCustomGroups = useHomeStore(
    visibility === 'private'
      ? homeAgentListSelectors.privateAgentGroups
      : homeAgentListSelectors.agentGroups,
    isEqual,
  );
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const [pinAgent, duplicateAgent, updateAgentGroup, removeAgent, toggleAgentLabel] = useHomeStore(
    (s) => [s.pinAgent, s.duplicateAgent, s.updateAgentGroup, s.removeAgent, s.toggleAgentLabel],
  );

  // Label picker: the shared registry (archived labels only stay listed while
  // still applied to this agent, so they can be unchecked but not re-added).
  const registryLabels = useHomeStore(agentLabelSelectors.allLabels, isEqual);
  const agentModal = useOptionalAgentModal();
  const openCreateLabelModal = agentModal?.openCreateLabelModal;
  const assignedLabelIds = useMemo(() => new Set((labels ?? []).map((l) => l.id)), [labels]);
  const pickerLabels = useMemo(
    () => registryLabels.filter((label) => !label.archived || assignedLabelIds.has(label.id)),
    [registryLabels, assignedLabelIds],
  );

  // Visibility actions are only meaningful inside a workspace: in personal
  // mode every row is implicitly owner-private. "Publish to Workspace"
  // appears on private agents; the inverse "Make private"
  // appears on published agents, but only for the creator ( —
  // owners demoting another member's agent would appropriate it), and never
  // on builtin agents (LobeAI etc.). The server enforces the same rules as
  // a backstop.
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  const isShownInSidebar = isSidebarItemVisible({ id, slug, type: 'agent', userId });
  const isPrivate = visibility === 'private';
  const isBuiltin = !!slug && BUILTIN_SLUGS.has(slug);
  const showPublishAction = Boolean(activeWorkspaceId) && isPrivate;
  const showMakePrivateAction =
    Boolean(activeWorkspaceId) &&
    visibility === 'public' &&
    !isBuiltin &&
    !!currentUserId &&
    userId === currentUserId;

  // Member Permissions only gate Agent configuration. Workspace-level list
  // organization (pin/group) and duplication remain available to members.
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { allowed: canCreate } = usePermission('create_content');
  // Label CRUD is admin-gated inside a workspace; personal mode has no such
  // gate, since the registry belongs to the single user who owns it and both
  // scopes now have a management page at `/settings/labels`.
  const { allowed: canManageLabels } = usePermission('manage_settings');
  const canCreateLabel =
    Boolean(openCreateLabelModal) && (activeWorkspaceId ? canManageLabels : true);
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', id);
  const canConfigure = canEdit && isAccessResolved && canEditResource;

  // Row-level ownership: delete/transfer/visibility management stays scoped
  // to the creator or a workspace owner, separate from collaborative editing.
  const canManage = useResourceManageable(userId);

  // Cross-workspace Transfer to… / Copy to… items (null when workspace
  // feature is off or the viewer lacks permission for this agent)
  const transferMenuItems = useAgentTransferMenuItem(
    id,
    {
      avatar,
      backgroundColor,
      title,
    },
    { userId, visibility },
  );

  const isDefault = group === SessionDefaultGroup.Default;

  // Visibility flips move the item across accordions. Reveal the destination
  // section afterwards — with a collapsed/hidden target (stale persisted
  // `sidebarExpandedKeys` predate newer sections) the item would silently
  // vanish from the sidebar.
  const revealSidebarSection = useRevealSidebarSection();

  return useMemo(
    () => () =>
      [
        ...(canEdit
          ? [
              {
                icon: <Icon icon={pinned ? PinOff : Pin} />,
                key: 'pin',
                label: t(pinned ? 'pinOff' : 'pin'),
                onClick: () => pinAgent(id, !pinned),
                sfSymbol: pinned ? 'pin.slash' : 'pin',
              },
            ]
          : []),
        ...(isShownInSidebar
          ? [
              {
                icon: <Icon icon={EyeOffIcon} />,
                key: 'hideFromSidebar',
                label: t('agentViewAll.removeFromSidebar', { ns: 'common' }),
                onClick: async ({ domEvent }: any) => {
                  domEvent?.stopPropagation();
                  try {
                    await setSidebarItemVisible(id, false);
                  } catch (error) {
                    console.error('Failed to hide Agent from sidebar:', error);
                    toast.error(t('operationFailed', { ns: 'common' }));
                  }
                },
                sfSymbol: 'sidebar.left',
              },
            ]
          : []),
        {
          icon: <Icon icon={PictureInPicture2Icon} />,
          key: 'openInNewWindow',
          label: t('openInNewWindow'),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            openAgentInNewWindow(id);
          },
          sfSymbol: 'macwindow.badge.plus',
        },
        ...(canConfigure || canCreate || canEdit ? [{ type: 'divider' as const }] : []),
        ...(canConfigure
          ? [
              {
                // Renaming is config co-editing, which stays collaborative for
                // shared agents — only ownership actions remain creator/owner-scoped.
                icon: <Icon icon={Pen} />,
                key: 'rename',
                label: t('rename', { ns: 'common' }),
                onClick: (info: any) => {
                  info.domEvent?.stopPropagation();
                  if (anchor) {
                    openEditingPopover({ anchor, avatar, id, title, type: 'agent' });
                  }
                },
                sfSymbol: 'pencil',
              },
            ]
          : []),
        ...(canCreate
          ? [
              {
                icon: <Icon icon={LucideCopy} />,
                key: 'duplicate',
                label: t('duplicate', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  duplicateAgent(id);
                },
                sfSymbol: 'doc.on.doc',
              },
            ]
          : []),
        ...(canEdit
          ? [
              {
                children: [
                  ...sessionCustomGroups.map(({ id: groupId, name }) => ({
                    icon: group === groupId ? <Icon icon={Check} /> : <div />,
                    key: groupId,
                    label: name,
                    onClick: async () => {
                      // A rejected move (folder deleted meanwhile, visibility
                      // mismatch, missing role) must surface — swallowed, it
                      // reads as "Move to Category does nothing".
                      try {
                        await updateAgentGroup(id, groupId);
                      } catch (error) {
                        console.error('Failed to move agent to category:', error);
                        toast.error(t('operationFailed', { ns: 'common' }));
                      }
                    },
                    sfSymbol: group === groupId ? 'checkmark' : undefined,
                  })),
                  {
                    icon: isDefault ? <Icon icon={Check} /> : <div />,
                    key: 'defaultList',
                    label: t('defaultList'),
                    onClick: async () => {
                      try {
                        await updateAgentGroup(id, SessionDefaultGroup.Default);
                      } catch (error) {
                        console.error('Failed to move agent to category:', error);
                        toast.error(t('operationFailed', { ns: 'common' }));
                      }
                    },
                    sfSymbol: isDefault ? 'checkmark' : undefined,
                  },
                  { type: 'divider' as const },
                  {
                    icon: <Icon icon={LucidePlus} />,
                    key: 'createGroup',
                    label: t('sessionGroup.createGroup'),
                    onClick: ({ domEvent }: any) => {
                      domEvent.stopPropagation();
                      openCreateGroupModal();
                    },
                    sfSymbol: 'folder.badge.plus',
                  },
                ],
                icon: <Icon icon={FolderInputIcon} />,
                key: 'moveGroup',
                label: t('sessionGroup.moveGroup'),
                sfSymbol: 'folder',
              },
            ]
          : []),
        // Labels work in both scopes: workspace mode uses the shared
        // workspace registry, personal mode a personal one. Clicking an entry
        // toggles that label on the agent.
        //
        // Gated on `canEdit`, matching the server: labelling is list
        // organization, so any member may tag any agent they can see. Using
        // the per-resource `canConfigure` here would hide the submenu on most
        // of a workspace's agents — the shared list a member most wants to
        // organize.
        ...(canEdit && labelsEnabled
          ? [
              {
                children: [
                  // Keep `label` a plain string so the menu stays eligible for
                  // the native desktop context menu (canGoNative). The icon
                  // slot stacks a fixed-width check area + the color dot, so
                  // an applied label keeps its color (mirrors Linear).
                  ...pickerLabels.map((label) => ({
                    icon: (
                      <span
                        style={{
                          alignItems: 'center',
                          display: 'inline-flex',
                          flex: 'none',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            justifyContent: 'center',
                            width: 14,
                          }}
                        >
                          {assignedLabelIds.has(label.id) ? <Icon icon={Check} size={14} /> : null}
                        </span>
                        <span
                          style={{
                            background: label.color || 'currentColor',
                            borderRadius: '50%',
                            display: 'inline-block',
                            flex: 'none',
                            height: 8,
                            opacity: label.color ? 1 : 0.35,
                            width: 8,
                          }}
                        />
                      </span>
                    ),
                    key: `label-${label.id}`,
                    label: label.name,
                    onClick: async ({ domEvent }: any) => {
                      domEvent?.stopPropagation();
                      // Delta, not a full replacement: `assignedLabelIds` is
                      // only as fresh as the last list fetch, so sending the
                      // whole set would drop a label another editor (or
                      // another tab) added since.
                      try {
                        await toggleAgentLabel(id, label.id, !assignedLabelIds.has(label.id));
                      } catch (error) {
                        console.error('Failed to update agent labels:', error);
                        toast.error(t('operationFailed', { ns: 'common' }));
                      }
                    },
                    sfSymbol: assignedLabelIds.has(label.id) ? 'checkmark' : undefined,
                  })),
                  ...(pickerLabels.length > 0 ? [{ type: 'divider' as const }] : []),
                  // In-place creation: creating a label from the picker and
                  // then having to reopen it would be surprising, so the
                  // submenu carries its own "New label" entry.
                  ...(canCreateLabel
                    ? [
                        {
                          icon: <Icon icon={LucidePlus} />,
                          key: 'createLabel',
                          label: t('agentLabel.create', { ns: 'common' }),
                          onClick: ({ domEvent }: any) => {
                            domEvent?.stopPropagation();
                            // Creating from an agent's submenu applies the new
                            // label to that agent right away.
                            openCreateLabelModal?.({
                              agentId: id,
                              currentLabelIds: [...assignedLabelIds],
                            });
                          },
                          sfSymbol: 'plus',
                        },
                      ]
                    : []),
                  // `/settings/labels` resolves in both scopes: the workspace
                  // settings tree and the personal one both render the same
                  // page, which reads the active workspace itself.
                  {
                    icon: <Icon icon={Settings2Icon} />,
                    key: 'manageLabels',
                    label: t('agentLabel.manage', { ns: 'common' }),
                    onClick: ({ domEvent }: any) => {
                      domEvent?.stopPropagation();
                      navigate('/settings/labels');
                    },
                    sfSymbol: 'gearshape',
                  },
                ],
                icon: <Icon icon={TagIcon} />,
                key: 'labels',
                label: t('agentLabel.menuTitle', { ns: 'common' }),
                sfSymbol: 'tag',
              },
            ]
          : []),
        ...(canConfigure && transferMenuItems?.length ? transferMenuItems : []),
        ...(canConfigure
          ? [
              // Permissions live on their own page now — the sidebar keeps a
              // shortcut so members don't have to open the Agent first.
              ...(activeWorkspaceId
                ? [
                    { type: 'divider' as const },
                    {
                      icon: <Icon icon={UsersIcon} />,
                      key: 'permission',
                      label: t('permission.page.entry', { ns: 'setting' }),
                      onClick: ({ domEvent }: any) => {
                        domEvent?.stopPropagation();
                        navigate(`/agent/${id}/permission`);
                      },
                      sfSymbol: 'person.2',
                    },
                  ]
                : []),
              ...(showPublishAction
                ? [
                    {
                      icon: <Icon icon={GlobeIcon} />,
                      key: 'publishToWorkspace',
                      label: t('agent.publishToWorkspace', {
                        defaultValue: 'Publish to Workspace',
                      }),
                      onClick: async ({ domEvent }: any) => {
                        domEvent?.stopPropagation();
                        confirmModal({
                          cancelText: t('cancel', { ns: 'common' }),
                          content: <VisibilityConfirmContent variant="publish" />,
                          okText: t('agent.publishToWorkspace', {
                            defaultValue: 'Publish to Workspace',
                          }),
                          onOk: async () => {
                            try {
                              await agentService.publishAgentToWorkspace(id);
                              await refreshAgentList();
                              revealSidebarSection('agent');
                              toast.success(
                                t('agent.publishToWorkspaceSuccess', {
                                  defaultValue: 'Published to workspace',
                                }),
                              );
                            } catch (error) {
                              console.error('Failed to publish agent:', error);
                              const publishErrorKey = getAgentPublishErrorKey(error);
                              toast.error(
                                publishErrorKey
                                  ? t(publishErrorKey)
                                  : t('error', {
                                      ns: 'common',
                                      defaultValue: 'Operation failed',
                                    }),
                              );
                            }
                          },
                          title: t('agent.publishToWorkspace', {
                            defaultValue: 'Publish to Workspace',
                          }),
                        });
                      },
                      sfSymbol: 'globe',
                    },
                  ]
                : []),
              ...(showMakePrivateAction
                ? [
                    {
                      icon: <Icon icon={EyeOffIcon} />,
                      key: 'makePrivate',
                      label: t('makePrivate', { ns: 'common' }),
                      onClick: async ({ domEvent }: any) => {
                        domEvent?.stopPropagation();
                        confirmModal({
                          cancelText: t('cancel', { ns: 'common' }),
                          content: <VisibilityConfirmContent variant="makePrivate" />,
                          okButtonProps: { danger: true },
                          okText: t('makePrivate.confirm.ok', { ns: 'common' }),
                          onOk: async () => {
                            try {
                              await agentService.setAgentVisibility(id, 'private');
                              await refreshAgentList();
                              revealSidebarSection('private');
                              toast.success(t('makePrivate.success', { ns: 'common' }));
                            } catch (error) {
                              console.error('Failed to make agent private:', error);
                              toast.error(t('makePrivate.error', { ns: 'common' }));
                            }
                          },
                          title: t('makePrivate.confirm.title', { ns: 'common' }),
                        });
                      },
                      sfSymbol: 'eye.slash',
                    },
                  ]
                : []),
              ...(canManage
                ? [
                    { type: 'divider' as const },
                    {
                      danger: true,
                      icon: <Icon icon={Trash} />,
                      key: 'delete',
                      label: t('delete', { ns: 'common' }),
                      onClick: ({ domEvent }: any) => {
                        domEvent.stopPropagation();
                        confirmModal({
                          cancelText: t('cancel', { ns: 'common' }),
                          content: t('confirmRemoveSessionItemAlert'),
                          okButtonProps: { danger: true },
                          okText: t('delete', { ns: 'common' }),
                          onOk: async () => {
                            try {
                              await removeAgent(id);
                              toast.success(t('confirmRemoveSessionSuccess'));
                            } catch (error) {
                              toast.error(t(getDeleteErrorMessageKey(error), { ns: 'common' }));
                            }
                          },
                          title: t('delete', { ns: 'common' }),
                        });
                      },
                      sfSymbol: 'trash',
                    },
                  ]
                : []),
            ]
          : []),
      ] as MenuProps['items'],
    [
      activeWorkspaceId,
      anchor,
      canCreate,
      canConfigure,
      canEdit,
      canManage,
      navigate,
      pinned,
      id,
      avatar,
      title,
      pinAgent,
      duplicateAgent,
      updateAgentGroup,
      removeAgent,
      toggleAgentLabel,
      pickerLabels,
      assignedLabelIds,
      canCreateLabel,
      labelsEnabled,
      openCreateLabelModal,
      openAgentInNewWindow,
      sessionCustomGroups,
      group,
      isDefault,
      openCreateGroupModal,
      transferMenuItems,
      showPublishAction,
      showMakePrivateAction,
      isShownInSidebar,
      setSidebarItemVisible,
      refreshAgentList,
      revealSidebarSection,
      t,
    ],
  );
};
