import type { TaskStatus } from '@lobechat/types';
import { type DropdownItem, DropdownMenu, Icon, type MenuInfo, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { renderMenuExtra } from './menuExtra';
import { STATUS_META, USER_SELECTABLE_STATUSES } from './taskStatusMeta';
import { useTaskStatusChange } from './useTaskStatusChange';

export { STATUS_META, USER_SELECTABLE_STATUSES } from './taskStatusMeta';

const styles = createStaticStyles(({ css, cssVar }) => ({
  trigger: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: filter ${cssVar.motionDurationMid};

    &:hover {
      filter: brightness(0.85);
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    display: inline-flex;
    opacity: 0.5;

    &:hover {
      filter: none;
    }
  `,
}));

interface TaskStatusTagProps {
  children?: ReactNode;
  disableDropdown?: boolean;
  onChange?: (status: TaskStatus) => void;
  size?: number;
  status?: TaskStatus;
  taskIdentifier?: string;
}

const TaskStatusTag = memo<TaskStatusTagProps>(
  ({ children, disableDropdown, onChange, size = 16, status, taskIdentifier }) => {
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const { t } = useTranslation('chat');
    const { allowed: canEditTask, reason } = usePermission('create_content');
    const changeTaskStatus = useTaskStatusChange();

    const displayStatus = status ?? 'backlog';
    const meta = STATUS_META[displayStatus];

    const handleStatusChange = useCallback(
      async (nextStatus: TaskStatus) => {
        if (!canEditTask) return;
        if (nextStatus === displayStatus) return;
        if (onChange) {
          onChange(nextStatus);
          return;
        }
        if (!taskIdentifier) return;
        setLoading(true);

        try {
          await changeTaskStatus(taskIdentifier, nextStatus);
        } finally {
          setLoading(false);
        }
      },
      [canEditTask, changeTaskStatus, displayStatus, onChange, taskIdentifier],
    );

    const handleStatusChangeRef = useRef(handleStatusChange);
    handleStatusChangeRef.current = handleStatusChange;

    useEffect(() => {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        const num = Number.parseInt(event.key, 10);
        if (Number.isNaN(num)) return;
        const idx = num - 1;
        if (idx < 0 || idx >= USER_SELECTABLE_STATUSES.length) return;
        event.preventDefault();
        event.stopPropagation();
        void handleStatusChangeRef.current(USER_SELECTABLE_STATUSES[idx]);
        setOpen(false);
      };
      document.addEventListener('keydown', onKeyDown, true);
      return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [open]);

    const menuItems = useMemo<DropdownItem[]>(
      () =>
        USER_SELECTABLE_STATUSES.map((key, index) => {
          const statusMeta = STATUS_META[key];
          const isCurrent = key === displayStatus;
          return {
            extra: renderMenuExtra(String(index + 1), isCurrent),
            icon: <Icon color={statusMeta.color} icon={statusMeta.icon} size={16} />,
            key,
            label: t(`taskDetail.${statusMeta.labelKey}`, { defaultValue: statusMeta.label }),
            onClick: ({ domEvent }: MenuInfo) => {
              domEvent.stopPropagation();
              void handleStatusChange(key);
            },
          };
        }),
      [displayStatus, handleStatusChange, t],
    );

    const triggerNode =
      children ||
      (loading ? (
        <Icon spin color={cssVar.colorTextDescription} icon={Loader2Icon} size={size} />
      ) : (
        <Tooltip title={t(`taskDetail.${meta.labelKey}`, { defaultValue: meta.label })}>
          <span className={styles.trigger} onClick={(e) => e.stopPropagation()}>
            <Icon color={meta.color} icon={meta.icon} size={size} />
          </span>
        </Tooltip>
      ));

    if (disableDropdown) return <>{triggerNode}</>;

    if (!canEditTask)
      return (
        <Tooltip title={reason}>
          <span className={styles.triggerDisabled} onClick={(e) => e.stopPropagation()}>
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

export default TaskStatusTag;
