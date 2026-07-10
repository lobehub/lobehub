import { type DropdownItem, DropdownMenu, Icon, type MenuInfo, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon, LockIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';

import { renderMenuExtra } from './menuExtra';
import { getTaskVisibilityDefaultLabel, getTaskVisibilityLabelKey } from './taskVisibilityLabel';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;

    color: ${cssVar.colorTextDescription};

    transition: color ${cssVar.motionDurationMid};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      color: ${cssVar.colorTextDescription};
      filter: none;
    }
  `,
}));

const VISIBILITY_OPTIONS: Array<'private' | 'public'> = ['private', 'public'];

interface TaskVisibilityTagProps {
  /** Render trigger UI (chip / icon). When omitted, the component renders the
   *  default tooltip + icon. */
  children?: ReactNode;
  /** Hide the dropdown entirely — used by callers that only want the icon. */
  disableDropdown?: boolean;
  /** When set, treats the chip as locked: dropdown is suppressed and a
   *  tooltip explains why. Used by the create form when the selected agent
   *  is private (a private agent can only run private tasks). */
  lockedReason?: string;
  /** Controlled mode (e.g. create form): caller owns the state. */
  onChange?: (next: 'private' | 'public') => void;
  size?: number;
  /** Persisted mode: when set, the dropdown calls `updateTaskVisibility` on the
   *  store directly. Mutually exclusive with `onChange`. */
  taskIdentifier?: string;
  visibility: 'private' | 'public';
}

const TaskVisibilityTag = memo<TaskVisibilityTagProps>(
  ({
    children,
    disableDropdown,
    lockedReason,
    onChange,
    size = 14,
    taskIdentifier,
    visibility,
  }) => {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const { t } = useTranslation('chat');
    const activeWorkspaceId = useActiveWorkspaceId();
    const { allowed: canEdit, reason } = usePermission('create_content');
    const updateTaskVisibility = useTaskStore((s) => s.updateTaskVisibility);

    const handleVisibilityChange = useCallback(
      async (next: 'private' | 'public') => {
        if (next === visibility) return;
        if (onChange) {
          onChange(next);
          return;
        }
        if (!taskIdentifier) return;
        setLoading(true);
        try {
          await updateTaskVisibility(taskIdentifier, next);
        } finally {
          setLoading(false);
        }
      },
      [onChange, taskIdentifier, updateTaskVisibility, visibility],
    );

    const IconComp = visibility === 'private' ? LockIcon : UsersIcon;
    const label = t(getTaskVisibilityLabelKey(visibility) as never, {
      defaultValue: getTaskVisibilityDefaultLabel(visibility),
    });

    const menuItems = useMemo<DropdownItem[]>(
      () =>
        VISIBILITY_OPTIONS.map((option, index) => {
          const OptionIcon = option === 'private' ? LockIcon : UsersIcon;
          const isCurrent = option === visibility;
          return {
            extra: renderMenuExtra(String(index + 1), isCurrent),
            icon: <Icon color={cssVar.colorTextSecondary} icon={OptionIcon} size={16} />,
            key: option,
            label: t(getTaskVisibilityLabelKey(option) as never, {
              defaultValue: getTaskVisibilityDefaultLabel(option),
            }),
            onClick: ({ domEvent }: MenuInfo) => {
              domEvent.stopPropagation();
              void handleVisibilityChange(option);
            },
          };
        }),
      [handleVisibilityChange, t, visibility],
    );

    // Personal mode: the visibility column exists but the workspace-mode
    // filtering is inert — hide the UI entirely so users aren't asked to make
    // a meaningless choice.
    if (!activeWorkspaceId && !taskIdentifier) return null;

    const triggerNode = children ? (
      children
    ) : loading ? (
      <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
    ) : (
      <Tooltip title={label}>
        <span className={styles.trigger} onClick={(e) => e.stopPropagation()}>
          <IconComp size={size} />
        </span>
      </Tooltip>
    );

    if (disableDropdown) return <>{triggerNode}</>;
    if (lockedReason)
      return (
        <Tooltip title={lockedReason}>
          <span
            className={styles.triggerDisabled}
            style={{ display: 'inline-flex' }}
            onClick={(e) => e.stopPropagation()}
          >
            {triggerNode}
          </span>
        </Tooltip>
      );
    if (!canEdit)
      return (
        <Tooltip title={reason}>
          <span
            className={styles.triggerDisabled}
            style={{ display: 'inline-flex' }}
            onClick={(e) => e.stopPropagation()}
          >
            {triggerNode}
          </span>
        </Tooltip>
      );

    return (
      <DropdownMenu items={menuItems} open={open} onOpenChange={setOpen}>
        {triggerNode}
      </DropdownMenu>
    );
  },
);

TaskVisibilityTag.displayName = 'TaskVisibilityTag';

export default TaskVisibilityTag;
