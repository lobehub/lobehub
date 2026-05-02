import type { TaskDetailSubtask } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Icon, showContextMenu, Text } from '@lobehub/ui';
import { Button, ConfigProvider, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { cssVar } from 'antd-style';
import { ChevronDown, ListTodoIcon, Plus } from 'lucide-react';
import type { Key, MouseEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import CreateTaskInlineEntry from '../AgentTaskList/CreateTaskInlineEntry';
import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import { useTaskContextMenuActions } from '../features/useTaskItemContextMenu';
import AccordionArrowIcon from '../shared/AccordionArrowIcon';
import { styles } from '../shared/style';

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

const TASK_STATUS_SET = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
]);

const toTaskStatus = (status: string): TaskStatus =>
  TASK_STATUS_SET.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

interface TaskTreeNode {
  children: TaskTreeNode[];
  task: TaskDetailSubtask;
}

const buildTree = (subtasks: TaskDetailSubtask[]): TaskTreeNode[] =>
  subtasks.map((task) => ({
    children: buildTree(task.children ?? []),
    task,
  }));

const SubtaskTitle = memo<{ task: TaskDetailSubtask }>(({ task }) => {
  const status = toTaskStatus(task.status);
  const isRunning = status === 'running';
  const hasName = !!task.name;

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      justify="space-between"
      style={{ minWidth: 0, width: '100%' }}
    >
      <span
        style={{ alignItems: 'center', display: 'inline-flex', flex: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <TaskPriorityTag priority={task.priority} size={14} taskIdentifier={task.identifier} />
      </span>
      <span
        style={{ alignItems: 'center', display: 'inline-flex', flex: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <TaskStatusTag size={14} status={status} taskIdentifier={task.identifier} />
      </span>
      {hasName && (
        <Text fontSize={13} style={{ flex: 'none' }} type={'secondary'}>
          {task.identifier}
        </Text>
      )}
      <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
        {task.name || task.identifier}
      </Text>
      {task.automationMode ? (
        <span
          style={{ alignItems: 'center', display: 'inline-flex', flex: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskTriggerTag
            automationMode={task.automationMode}
            heartbeatInterval={task.heartbeat?.interval}
            schedulePattern={task.schedule?.pattern}
            scheduleTimezone={task.schedule?.timezone}
          />
        </span>
      ) : null}
      <AssigneeAgentSelector
        currentAgentId={task.assignee?.id ?? null}
        disabled={isRunning}
        taskIdentifier={task.identifier}
      >
        <span
          style={{
            alignItems: 'center',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            flex: 'none',
          }}
        >
          <AssigneeAvatar agentId={task.assignee?.id} size={18} />
        </span>
      </AssigneeAgentSelector>
    </Flexbox>
  );
});

const toTreeData = (tree: TaskTreeNode[]): DataNode[] => {
  return tree.map((node) => ({
    children: toTreeData(node.children),
    key: node.task.identifier,
    title: <SubtaskTitle task={node.task} />,
  }));
};

const TaskSubtasks = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);

  const { buildItems, installKeyboardHandlers } = useTaskContextMenuActions();

  const [isCreating, setIsCreating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleNavigate = useCallback(
    (identifier: string) => {
      navigate(`/task/${identifier}`);
    },
    [navigate],
  );

  const subtaskMap = useMemo(() => {
    const map = new Map<string, TaskDetailSubtask>();
    const walk = (items: TaskDetailSubtask[]) => {
      for (const item of items) {
        map.set(item.identifier, item);
        if (item.children?.length) walk(item.children);
      }
    };
    walk(subtasks);
    return map;
  }, [subtasks]);

  const treeData = useMemo(() => {
    if (subtasks.length === 0) return [];
    return toTreeData(buildTree(subtasks));
  }, [subtasks]);

  const handleRightClick = useCallback(
    ({ event, node }: { event: MouseEvent; node: { key: Key } }) => {
      const subtask = subtaskMap.get(String(node.key));
      if (!subtask) return;
      event.preventDefault();
      showContextMenu(
        buildItems({
          identifier: subtask.identifier,
          priority: subtask.priority,
          status: subtask.status,
        }),
      );
      installKeyboardHandlers({
        identifier: subtask.identifier,
        priority: subtask.priority,
        status: subtask.status,
      });
    },
    [subtaskMap, buildItems, installKeyboardHandlers],
  );

  const toggleCreating = useCallback(() => setIsCreating((prev) => !prev), []);

  if (!taskId) return null;

  const hasSubtasks = subtasks.length > 0;

  return (
    <Flexbox gap={8}>
      {hasSubtasks ? (
        <>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Block
                clickable
                horizontal
                align="center"
                gap={8}
                paddingBlock={4}
                paddingInline={8}
                style={{ cursor: 'pointer', width: 'fit-content' }}
                variant="borderless"
                onClick={() => setIsExpanded((prev) => !prev)}
              >
                <Icon color={cssVar.colorTextDescription} icon={ListTodoIcon} size={16} />
                <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
                  {t('taskDetail.subtasks')}
                </Text>
                <AccordionArrowIcon
                  isOpen={isExpanded}
                  style={{ color: cssVar.colorTextDescription }}
                />
              </Block>
              <TaskSubtaskProgressTag
                currentIdentifier={taskId}
                subtasks={subtasks}
                onSubtaskClick={handleNavigate}
              />
            </Flexbox>
            <ActionIcon
              icon={Plus}
              size="small"
              title={t('taskDetail.addSubtask')}
              onClick={toggleCreating}
            />
          </Flexbox>
          {isExpanded && (
            <>
              {isCreating && (
                <CreateTaskInlineEntry
                  autoFocus
                  agentId={agentId ?? undefined}
                  parentTaskId={taskId}
                  placeholder={t('taskDetail.subtaskInstructionPlaceholder')}
                  onCollapse={() => setIsCreating(false)}
                  onCreated={() => setIsCreating(false)}
                />
              )}
              <ConfigProvider theme={{ components: { Tree: { titleHeight: 36 } } }}>
                <Tree
                  blockNode
                  defaultExpandAll
                  showLine
                  className={styles.subtaskTree}
                  switcherIcon={<Icon icon={ChevronDown} size={14} />}
                  treeData={treeData}
                  onRightClick={handleRightClick}
                  onSelect={(keys) => {
                    const key = keys[0];
                    if (!key) return;
                    handleNavigate(String(key));
                  }}
                />
              </ConfigProvider>
            </>
          )}
        </>
      ) : (
        <>
          <Flexbox horizontal align="flex-start">
            <Button
              className={styles.addSubtaskButton}
              icon={<Icon icon={Plus} size={14} />}
              shape="round"
              size="small"
              type="text"
              onClick={toggleCreating}
            >
              {t('taskDetail.addSubtask')}
            </Button>
          </Flexbox>
          {isCreating && (
            <CreateTaskInlineEntry
              autoFocus
              agentId={agentId ?? undefined}
              parentTaskId={taskId}
              placeholder={t('taskDetail.subtaskInstructionPlaceholder')}
              onCollapse={() => setIsCreating(false)}
              onCreated={() => setIsCreating(false)}
            />
          )}
        </>
      )}
    </Flexbox>
  );
});

export default TaskSubtasks;
