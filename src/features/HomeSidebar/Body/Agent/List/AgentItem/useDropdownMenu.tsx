import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  agentRenameField,
  SessionDefaultGroup,
  type SidebarAgentLabel,
  type SidebarVisibility,
} from '@lobechat/types';
import { type DropdownItem } from '@lobehub/ui';
import { Icon, toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import {
  Check,
  EyeOffIcon,
  FolderInputIcon,
  LucideCopy,
  LucidePlus,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  Settings2Icon,
  ShieldIcon,
  TagIcon,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { openRenameModal } from '@/components/RenameModal';
import { confirmRemoveAgent } from '@/features/AgentDeleteConfirm';
import { useOptionalAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCopyAgentIdMenuItem } from '@/hooks/useCopyAgentIdMenuItem';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { agentLabelSelectors, homeAgentListSelectors } from '@/store/home/selectors';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';

import { useSidebarItemVisibility } from '../../useSidebarItemVisibility';
import { useSidebarPinMenuItems } from '../../useSidebarPinMenuItems';

interface UseAgentDropdownMenuParams {
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
  /** The agent's personal name — the row label is this when set, the role otherwise. */
  name?: string | null;
  openCreateGroupModal: () => void;
  pinned: boolean;
  slug?: string | null;
  title: string;
  userId?: string | null;
  visibility?: SidebarVisibility;
}

export const useAgentDropdownMenu = ({
  group,
  id,
  labels,
  labelsEnabled,
  name,
  openCreateGroupModal,
  pinned,
  slug,
  title,
  userId,
  visibility,
}: UseAgentDropdownMenuParams): (() => DropdownItem[]) => {
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
  const [
    pinAgent,
    duplicateAgent,
    updateAgentGroup,
    removeAgent,
    toggleAgentLabel,
    updateAgentMeta,
  ] = useHomeStore((s) => [
    s.pinAgent,
    s.duplicateAgent,
    s.updateAgentGroup,
    s.removeAgent,
    s.toggleAgentLabel,
    s.updateAgentMeta,
  ]);

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

  const activeWorkspaceId = useActiveWorkspaceId();
  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  const isShownInSidebar = isSidebarItemVisible({ id, slug, type: 'agent', userId });

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
  const { canEditResource, canManageResource, isAccessResolved } = useResourceAccess('agent', id);
  const canConfigure = canEdit && isAccessResolved && canEditResource;

  // Row-level ownership: delete/transfer/visibility management stays scoped
  // to the creator or a workspace owner, separate from collaborative editing.
  const canManage = useResourceManageable(userId);
  // Delete also opens to a workspace Admin on another member's shared agent
  // (server `canManage`); the confirmation then warns that someone else created
  // it, and the server only accepts the delete with that acknowledgment.
  // Lobe AI (the inbox) is listed like any Agent, but it is the scope's
  // built-in default: it cannot be deleted, handed over or moved elsewhere.
  const isInbox = slug === INBOX_SESSION_ID;
  const canDelete = !isInbox && (canManage || canManageResource);

  const canManagePermission = !isInbox && canManageResource;

  const copyAgentIdItem = useCopyAgentIdMenuItem(id);

  const isDefault = group === SessionDefaultGroup.Default;

  // Workspace: a personal pin for every member plus an owner/admin-only team
  // pin on public rows. Personal mode keeps the single column-backed pin.
  const { menuItems: workspacePinItems } = useSidebarPinMenuItems({
    id,
    pinned,
    type: 'agent',
    visibility,
  });

  return useMemo(
    () => () =>
      [
        ...(activeWorkspaceId
          ? workspacePinItems
          : canEdit
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
        ...(copyAgentIdItem ? [copyAgentIdItem] : []),
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
                  openRenameModal({
                    defaultValue: title,
                    onSave: async (newName) => {
                      try {
                        // The row shows `name` when the agent has one and the role
                        // otherwise; the rename writes back to that same field.
                        await updateAgentMeta(id, { [agentRenameField({ name })]: newName });
                      } catch (error) {
                        console.error('[agent:rename]', error);
                        toast.error(t('operationFailed', { ns: 'common' }));
                        // The shared modal closes on a resolved save; re-throw so the
                        // typed name survives for a retry.
                        throw error;
                      }
                    },
                  });
                },
                sfSymbol: 'pencil',
              },
            ]
          : []),
        // A copy of Lobe AI would come out nameless: its stored title is blank.
        ...(canCreate && !isInbox
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
        ...(canConfigure
          ? [
              // Member permissions, visibility, the handover to a member and
              // the cross-scope Transfer to… / Copy to… are low-frequency
              // management: they live in the Agent's settings, and the row
              // keeps one shortcut into the permission section for creators
              // and workspace owners.
              ...(activeWorkspaceId && canManagePermission
                ? [
                    { type: 'divider' as const },
                    {
                      icon: <Icon icon={ShieldIcon} />,
                      key: 'permission',
                      label: t('permission.page.agentEntry', { ns: 'setting' }),
                      onClick: ({ domEvent }: any) => {
                        domEvent?.stopPropagation();
                        navigate(`/agent/${id}/permission`);
                      },
                      sfSymbol: 'lock.shield',
                    },
                  ]
                : []),
              ...(canDelete
                ? [
                    { type: 'divider' as const },
                    {
                      danger: true,
                      icon: <Icon icon={Trash} />,
                      key: 'delete',
                      label: t('delete', { ns: 'common' }),
                      onClick: ({ domEvent }: any) => {
                        domEvent.stopPropagation();
                        confirmRemoveAgent({
                          agentId: id,
                          onConfirm: async (options) => {
                            try {
                              await removeAgent(id, options);
                              toast.success(t('confirmRemoveSessionSuccess'));
                            } catch (error) {
                              toast.error(t(getDeleteErrorMessageKey(error), { ns: 'common' }));
                            }
                          },
                        });
                      },
                      sfSymbol: 'trash',
                    },
                  ]
                : []),
            ]
          : []),
      ] as DropdownItem[],
    [
      activeWorkspaceId,
      workspacePinItems,
      canCreate,
      canConfigure,
      canEdit,
      canManagePermission,
      canDelete,
      isInbox,
      navigate,
      pinned,
      id,
      title,
      name,
      pinAgent,
      duplicateAgent,
      updateAgentGroup,
      removeAgent,
      toggleAgentLabel,
      updateAgentMeta,
      pickerLabels,
      assignedLabelIds,
      canCreateLabel,
      labelsEnabled,
      openCreateLabelModal,
      openAgentInNewWindow,
      copyAgentIdItem,
      sessionCustomGroups,
      group,
      isDefault,
      openCreateGroupModal,
      isShownInSidebar,
      setSidebarItemVisible,
      t,
    ],
  );
};
