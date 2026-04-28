import { type FormItemProps } from '@lobehub/ui';
import { ActionIcon, Flexbox, Form, Icon, Popover, Segmented, Select } from '@lobehub/ui';
import { Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  LayoutList,
  Settings2Icon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';

import type { TaskGroupBy, TaskListViewOptions, TaskOrderBy } from './listViewOptions';

interface TasksHeaderProps {
  options: TaskListViewOptions;
  setOptions: (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => void;
}

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    form: css`
      label {
        font-size: 13px !important;
        color: ${cssVar.colorTextSecondary} !important;
      }
    `,
  };
});

const TasksGroupConfig = memo<TasksHeaderProps>(({ options, setOptions }) => {
  const [isViewConfigOpen, setIsViewConfigOpen] = useState(false);
  const { t } = useTranslation('chat');
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const setViewMode = useTaskStore((s) => s.setViewMode);
  const groupingOptions = useMemo<Array<{ label: string; value: TaskGroupBy }>>(
    () => [
      { label: t('taskList.groupBy.none'), value: 'none' },
      { label: t('taskList.groupBy.status'), value: 'status' },
      { label: t('taskList.groupBy.assignee'), value: 'assignee' },
      { label: t('taskList.groupBy.priority'), value: 'priority' },
    ],
    [t],
  );
  const orderOptions = useMemo<Array<{ label: string; value: TaskOrderBy }>>(
    () => [
      { label: t('taskList.orderBy.status'), value: 'status' },
      { label: t('taskList.orderBy.priority'), value: 'priority' },
      { label: t('taskList.orderBy.updatedAt'), value: 'updatedAt' },
      { label: t('taskList.orderBy.createdAt'), value: 'createdAt' },
      { label: t('taskList.orderBy.assignee'), value: 'assignee' },
      { label: t('taskList.orderBy.title'), value: 'title' },
    ],
    [t],
  );

  const subGroupingOptions = useMemo(
    () => groupingOptions.filter((item) => item.value !== options.groupBy || item.value === 'none'),
    [groupingOptions, options.groupBy],
  );
  const isSubGroupingEnabled = options.groupBy !== 'none';

  const formItems: FormItemProps[] = [
    {
      children: (
        <Select
          options={groupingOptions}
          size={'small'}
          style={{ width: 150 }}
          value={options.groupBy}
          onChange={(value: TaskGroupBy) => {
            setOptions((prev) => ({
              ...prev,
              groupBy: value,
              subGroupBy: prev.subGroupBy === value ? 'none' : prev.subGroupBy,
            }));
          }}
        />
      ),
      label: t('taskList.form.grouping'),
    },
    ...(isSubGroupingEnabled
      ? [
          {
            children: (
              <Select
                options={subGroupingOptions}
                size={'small'}
                style={{ width: 150 }}
                value={options.subGroupBy}
                onChange={(value: TaskGroupBy) => {
                  setOptions((prev) => ({ ...prev, subGroupBy: value }));
                }}
              />
            ),
            label: t('taskList.form.subGrouping'),
          } satisfies FormItemProps,
        ]
      : []),
    {
      children: (
        <Flexbox horizontal align={'center'} gap={8}>
          <ActionIcon
            icon={options.orderDirection === 'asc' ? ArrowDownWideNarrow : ArrowUpNarrowWide}
            size={'small'}
            onClick={() => {
              setOptions((prev) => ({
                ...prev,
                orderDirection: prev.orderDirection === 'asc' ? 'desc' : 'asc',
              }));
            }}
          />
          <Select
            options={orderOptions}
            size={'small'}
            style={{ width: 112 }}
            value={options.orderBy}
            onChange={(value: TaskOrderBy) => {
              setOptions((prev) => ({ ...prev, orderBy: value }));
            }}
          />
        </Flexbox>
      ),
      label: t('taskList.form.ordering'),
    },
    {
      children: (
        <Switch
          checked={options.orderCompletedByRecency}
          size={'small'}
          onChange={(checked) => {
            setOptions((prev) => ({ ...prev, orderCompletedByRecency: checked }));
          }}
        />
      ),
      minWidth: undefined,
      label: t('taskList.form.orderCompletedByRecency'),
    },
    {
      children: (
        <Switch
          checked={!options.hideCompleted}
          size={'small'}
          onChange={(checked) => {
            setOptions((prev) => ({ ...prev, hideCompleted: !checked }));
          }}
        />
      ),
      minWidth: undefined,
      label: t('taskList.form.showCompleted'),
    },
  ];

  const panelContent = (
    <Flexbox gap={12} width={280}>
      <Segmented
        block
        value={viewMode}
        options={[
          { icon: <Icon icon={LayoutList} />, label: t('taskList.view.list'), value: 'list' },
          {
            icon: <Icon icon={LayoutGrid} />,
            label: t('taskList.view.board'),
            value: 'kanban',
          },
        ]}
        onChange={(value) => setViewMode(value as 'kanban' | 'list')}
      />
      {viewMode === 'list' && (
        <Form
          className={styles.form}
          items={formItems}
          itemsType={'flat'}
          size={'small'}
          variant={'borderless'}
          styles={{
            item: { padding: 0 },
          }}
        />
      )}
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={panelContent}
      open={isViewConfigOpen}
      placement={'bottomRight'}
      trigger={['click']}
      onOpenChange={setIsViewConfigOpen}
    >
      <ActionIcon icon={Settings2Icon} size={DESKTOP_HEADER_ICON_SIZE} />
    </Popover>
  );
});

export default TasksGroupConfig;
