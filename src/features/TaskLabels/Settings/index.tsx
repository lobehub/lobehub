'use client';

import type { TaskLabelWithUsage } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  SearchBar,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { EllipsisIcon, FolderPlusIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchTaskLabels } from '@/hooks/useFetchTaskLabels';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskLabelSelectors } from '@/store/task/selectors';
import { sx } from '@/styles/sx';

import TaskLabelDot from '../TaskLabelDot';
import { openTaskLabelFormModal } from './TaskLabelFormModal';

const styles = stylex.create({
  row: {
    paddingBlock: 10,
    paddingInlineEnd: 12,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
});

const USAGE_COL_WIDTH = 88;
const ACTION_COL_WIDTH = 32;

interface RowProps {
  canManage: boolean;
  depth: number;
  label: TaskLabelWithUsage;
  manageBlockedReason?: string;
}

const TaskLabelRow = memo<RowProps>(({ canManage, depth, label, manageBlockedReason }) => {
  const { t } = useTranslation(['setting', 'common']);
  const deleteTaskLabel = useTaskStore((s) => s.deleteTaskLabel);

  const confirmDelete = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t(label.isGroup ? 'taskLabels.delete.groupDesc' : 'taskLabels.delete.desc', {
        count: label.usageCount,
      }),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        try {
          await deleteTaskLabel(label.id);
        } catch {
          toast.error(t('operationFailed', { ns: 'common' }));
        }
      },
      title: t('taskLabels.delete.title', { name: label.name }),
    });

  const menuItems = [
    {
      icon: <Icon icon={PencilIcon} />,
      key: 'edit',
      label: t('edit', { ns: 'common' }),
      onClick: () => openTaskLabelFormModal({ label }),
    },
    ...(label.isGroup
      ? [
          {
            icon: <Icon icon={PlusIcon} />,
            key: 'add',
            label: t('taskLabels.actions.addToGroup'),
            onClick: () => openTaskLabelFormModal({ parentId: label.id }),
          },
        ]
      : []),
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Icon icon={Trash2Icon} />,
      key: 'delete',
      label: t('delete', { ns: 'common' }),
      onClick: confirmDelete,
    },
  ];

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={12}
      {...sx([styles.row], undefined, { paddingInlineStart: 12 + depth * 24 })}
    >
      <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
        <TaskLabelDot color={label.color} size={10} />
        <Text ellipsis weight={500}>
          {label.name}
        </Text>
        {label.isGroup && (
          <Text fontSize={12} type={'secondary'}>
            {t('taskLabels.groupBadge')}
          </Text>
        )}
      </Flexbox>
      <Text
        fontSize={12}
        style={{ flex: 'none', textAlign: 'end', width: USAGE_COL_WIDTH }}
        type={'secondary'}
      >
        {label.isGroup ? null : t('taskLabels.usage', { count: label.usageCount })}
      </Text>
      <Flexbox align={'center'} flex={'none'} style={{ width: ACTION_COL_WIDTH }}>
        {canManage ? (
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={EllipsisIcon} size={'small'} title={t('taskLabels.actions.more')} />
          </DropdownMenu>
        ) : (
          <Tooltip title={manageBlockedReason}>
            <ActionIcon
              disabled
              icon={EllipsisIcon}
              size={'small'}
              title={t('taskLabels.actions.more')}
            />
          </Tooltip>
        )}
      </Flexbox>
    </Flexbox>
  );
});

TaskLabelRow.displayName = 'TaskLabelRow';

/** Rows in registry order: top-level labels and groups, each group followed by its labels. */
const toRows = (labels: TaskLabelWithUsage[], keyword: string) => {
  const query = keyword.trim().toLowerCase();
  const matches = (label: TaskLabelWithUsage) => label.name.toLowerCase().includes(query);
  const rows: { depth: number; label: TaskLabelWithUsage }[] = [];
  for (const label of labels) {
    if (label.parentId) continue;
    const children = labels.filter((child) => child.parentId === label.id);
    const shownChildren = query && !matches(label) ? children.filter(matches) : children;
    if (query && !matches(label) && shownChildren.length === 0) continue;
    rows.push({ depth: 0, label });
    for (const child of shownChildren) rows.push({ depth: 1, label: child });
  }
  return rows;
};

/**
 * Settings → Labels → Tasks: the task label registry. Create labels and
 * label groups, rename, recolor, move a label into a group, delete.
 */
const TaskLabelsSettings = memo(() => {
  const { t } = useTranslation(['setting', 'common']);
  const { error, isLoading, mutate } = useFetchTaskLabels();
  const isInit = useTaskStore(taskLabelSelectors.isLabelsInit);
  const labels = useTaskStore(taskLabelSelectors.labels);

  // Same gate as task writes: members who can create content manage the
  // shared registry; viewers only read it. Personal mode is always allowed.
  const activeWorkspaceId = useActiveWorkspaceId();
  const { allowed, reason } = usePermission('create_content');
  const canManage = activeWorkspaceId ? allowed : true;
  const manageBlockedReason = activeWorkspaceId ? reason : undefined;

  const [keyword, setKeyword] = useState('');
  const rows = useMemo(() => toRows(labels, keyword), [keyword, labels]);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <SearchBar
          allowClear
          placeholder={t('taskLabels.filterPlaceholder')}
          style={{ maxWidth: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!canManage}
            icon={FolderPlusIcon}
            onClick={() => openTaskLabelFormModal({ isGroup: true })}
          >
            {t('taskLabels.actions.createGroup')}
          </Button>
          <Button
            disabled={!canManage}
            icon={PlusIcon}
            type={'primary'}
            onClick={() => openTaskLabelFormModal()}
          >
            {t('taskLabels.actions.create')}
          </Button>
        </Flexbox>
      </Flexbox>
      {!isInit && isLoading ? (
        <SkeletonList rows={4} />
      ) : error && !isInit ? (
        <Flexbox align={'center'} gap={12} paddingBlock={40}>
          <Empty description={t('taskLabels.loadFailed')} />
          <Button onClick={() => mutate()}>{t('retry', { ns: 'common' })}</Button>
        </Flexbox>
      ) : rows.length === 0 ? (
        <Empty
          description={keyword.trim() ? t('taskLabels.filterEmpty') : t('taskLabels.empty')}
          style={{ paddingBlock: 40 }}
        />
      ) : (
        <Flexbox gap={2}>
          {rows.map(({ depth, label }) => (
            <TaskLabelRow
              canManage={canManage}
              depth={depth}
              key={label.id}
              label={label}
              manageBlockedReason={manageBlockedReason}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

TaskLabelsSettings.displayName = 'TaskLabelsSettings';

export default TaskLabelsSettings;
