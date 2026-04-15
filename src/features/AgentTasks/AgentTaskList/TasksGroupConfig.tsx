import { ActionIcon, Flexbox, Icon, Segmented, Select, Text } from '@lobehub/ui';
import { Popover, Switch } from 'antd';
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

import { styles } from '../shared/style';
import type { TaskGroupBy, TaskListViewOptions, TaskOrderBy } from './listViewOptions';

interface TasksHeaderProps {
  options: TaskListViewOptions;
  setOptions: (updater: (prev: TaskListViewOptions) => TaskListViewOptions) => void;
}

const GROUPING_OPTIONS: Array<{ label: string; value: TaskGroupBy }> = [
  { label: 'No grouping', value: 'none' },
  { label: 'Status', value: 'status' },
  { label: 'Assignee', value: 'assignee' },
  { label: 'Priority', value: 'priority' },
];

const ORDER_OPTIONS: Array<{ label: string; value: TaskOrderBy }> = [
  { label: 'Status', value: 'status' },
  { label: 'Priority', value: 'priority' },
  { label: 'Updated at', value: 'updatedAt' },
  { label: 'Created at', value: 'createdAt' },
  { label: 'Assignee', value: 'assignee' },
  { label: 'Title', value: 'title' },
];

const TasksGroupConfig = memo<TasksHeaderProps>(({ options, setOptions }) => {
  const { t } = useTranslation('chat');
  const [isViewConfigOpen, setIsViewConfigOpen] = useState(false);
  const viewMode = useTaskStore(taskListSelectors.viewMode);
  const setViewMode = useTaskStore((s) => s.setViewMode);

  const subGroupingOptions = useMemo(
    () =>
      GROUPING_OPTIONS.filter((item) => item.value !== options.groupBy || item.value === 'none'),
    [options.groupBy],
  );
  const isSubGroupingEnabled = options.groupBy !== 'none';

  const panelContent = (
    <Flexbox className={styles.viewConfigPanel} gap={12}>
      <Segmented
        block
        value={viewMode}
        options={[
          { icon: <Icon icon={LayoutList} />, label: 'List', value: 'list' },
          { disabled: true, icon: <Icon icon={LayoutGrid} />, label: 'Board', value: 'kanban' },
        ]}
        onChange={(value) => setViewMode(value as 'kanban' | 'list')}
      />
      <div className={styles.viewConfigRow}>
        <Text type={'secondary'}>Grouping</Text>
        <Select
          options={GROUPING_OPTIONS}
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
      </div>
      {isSubGroupingEnabled && (
        <div className={styles.viewConfigRow}>
          <Text type={'secondary'}>Sub-grouping</Text>
          <Select
            options={subGroupingOptions}
            size={'small'}
            style={{ width: 150 }}
            value={options.subGroupBy}
            onChange={(value: TaskGroupBy) => {
              setOptions((prev) => ({ ...prev, subGroupBy: value }));
            }}
          />
        </div>
      )}
      <div className={styles.viewConfigRow}>
        <Text type={'secondary'}>Ordering</Text>
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
            options={ORDER_OPTIONS}
            size={'small'}
            style={{ width: 112 }}
            value={options.orderBy}
            onChange={(value: TaskOrderBy) => {
              setOptions((prev) => ({ ...prev, orderBy: value }));
            }}
          />
        </Flexbox>
      </div>
      <div className={styles.viewConfigRow}>
        <Text type={'secondary'}>Order completed by recency</Text>
        <Switch
          checked={options.orderCompletedByRecency}
          size={'small'}
          onChange={(checked) => {
            setOptions((prev) => ({ ...prev, orderCompletedByRecency: checked }));
          }}
        />
      </div>
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
