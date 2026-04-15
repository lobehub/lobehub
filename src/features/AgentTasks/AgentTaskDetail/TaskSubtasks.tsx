import type { TaskDetailSubtask } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { cssVar } from 'antd-style';
import { ChevronDown, ListTodoIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskStatusTag from '../features/TaskStatusTag';
import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';
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

const toTreeData = (tree: TaskTreeNode[]): DataNode[] => {
  return tree.map((node) => {
    const isCompleted = node.task.status === 'completed';
    const status = toTaskStatus(node.task.status);

    return {
      children: toTreeData(node.children),
      icon: (
        <div onClick={(e) => e.stopPropagation()}>
          <TaskStatusTag size={16} status={status} taskIdentifier={node.task.identifier} />
        </div>
      ),
      key: node.task.identifier,
      title: (
        <Text
          ellipsis
          as={'span'}
          style={{
            color: isCompleted ? cssVar.colorTextQuaternary : undefined,
            textDecoration: isCompleted ? 'line-through' : undefined,
          }}
        >
          {node.task.name || node.task.identifier}
        </Text>
      ),
    };
  });
};

const TaskSubtasks = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);

  const handleNavigate = useCallback(
    (identifier: string) => {
      if (agentId) navigate(`/agent/${agentId}/tasks/${identifier}`);
    },
    [agentId, navigate],
  );

  const treeData = useMemo(() => {
    if (subtasks.length === 0) return [];
    return toTreeData(buildTree(subtasks));
  }, [subtasks]);

  if (subtasks.length === 0) return null;

  return (
    <>
      <Divider dashed />
      <Accordion defaultExpandedKeys={['subtasks']} gap={0}>
        <AccordionItem
          itemKey="subtasks"
          paddingBlock={4}
          paddingInline={8}
          title={
            <Flexbox horizontal align="center" gap={8}>
              <Icon color={cssVar.colorTextDescription} icon={ListTodoIcon} size={16} />
              <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
                {t('taskDetail.subtasks')}
              </Text>
              <TaskSubtaskProgressTag
                currentIdentifier={taskId}
                subtasks={subtasks}
                onSubtaskClick={handleNavigate}
              />
            </Flexbox>
          }
        >
          <Tree
            blockNode
            defaultExpandAll
            showIcon
            showLine
            className={styles.subtaskTree}
            style={{ marginTop: 8 }}
            switcherIcon={<Icon icon={ChevronDown} size={14} />}
            treeData={treeData}
            onSelect={(keys) => {
              const key = keys[0];
              if (!key) return;
              handleNavigate(String(key));
            }}
          />
        </AccordionItem>
      </Accordion>
    </>
  );
});

export default TaskSubtasks;
