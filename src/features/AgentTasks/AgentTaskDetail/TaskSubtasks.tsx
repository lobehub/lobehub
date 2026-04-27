import type { TaskDetailSubtask } from '@lobechat/types';
import { ActionIcon, Avatar, Block, ContextMenuTrigger, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, ConfigProvider, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { cssVar } from 'antd-style';
import { ChevronDown, ListTodoIcon, Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import CreateTaskInlineEntry from '../AgentTaskList/CreateTaskInlineEntry';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';
import { useTaskItemContextMenu } from '../features/useTaskItemContextMenu';
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

const buildTree = (subtasks: TaskDetailSubtask[]): TaskTreeNode[] => {
  if (subtasks.some((item) => (item.children?.length ?? 0) > 0)) {
    return subtasks.map((task) => ({
      children: buildTree(task.children ?? []),
      task,
    }));
  }

  const nodeMap = new Map(
    subtasks.map((task) => [
      task.identifier,
      { children: [] as TaskTreeNode[], task } satisfies TaskTreeNode,
    ]),
  );
  const roots: TaskTreeNode[] = [];

  for (const task of subtasks) {
    const node = nodeMap.get(task.identifier);
    if (!node) continue;

    const parentIdentifier = task.blockedBy;
    const parent = parentIdentifier ? nodeMap.get(parentIdentifier) : undefined;
    if (parent && parent.task.identifier !== task.identifier) {
      parent.children.push(node);
      continue;
    }

    roots.push(node);
  }

  return roots;
};

const SubtaskTitle = memo<{ task: TaskDetailSubtask }>(({ task }) => {
  const status = toTaskStatus(task.status);
  const { items, onContextMenu } = useTaskItemContextMenu({
    identifier: task.identifier,
    priority: task.priority,
    status: task.status,
  });

  return (
    <ContextMenuTrigger items={items} onContextMenu={onContextMenu}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{ lineHeight: 1, minWidth: 0, overflow: 'hidden' }}
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
        <Text ellipsis fontSize={13} style={{ flex: 1, minWidth: 0 }}>
          {task.name || task.identifier}
        </Text>
        {task.assignee && (
          <span
            style={{ alignItems: 'center', display: 'inline-flex', flex: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar
              avatar={task.assignee.avatar ?? ''}
              background={task.assignee.backgroundColor || cssVar.colorBgContainer}
              shape="circle"
              size={18}
              title={task.assignee.title ?? ''}
              variant="outlined"
            />
          </span>
        )}
      </Flexbox>
    </ContextMenuTrigger>
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

  const [isCreating, setIsCreating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleNavigate = useCallback(
    (identifier: string) => {
      navigate(`/task/${identifier}`);
    },
    [navigate],
  );

  const treeData = useMemo(() => {
    if (subtasks.length === 0) return [];
    return toTreeData(buildTree(subtasks));
  }, [subtasks]);

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
                <Icon
                  color={cssVar.colorTextDescription}
                  icon={ChevronDown}
                  size={14}
                  style={{
                    transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 200ms',
                  }}
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
