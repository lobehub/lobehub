import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress, Spin } from 'antd';
import { cssVar } from 'antd-style';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { buildTaskTree, countTreeNodes, type TaskTreeNode } from './buildTaskTree';
import { styles } from './style';

/**
 * Recursive tree item with Linear-style connecting lines.
 *
 * Line model per child wrapper:
 * - Non-last child: full-height border-left (vertical line continues)
 * - Last child: border-left only to row center (L-shape, line stops)
 * - Each row: horizontal connector from vertical line to circle
 */
const SubtaskTreeItem = memo<{
  isLast: boolean;
  node: TaskTreeNode;
  onNavigate: (identifier: string) => void;
}>(({ node, isLast, onNavigate }) => {
  const done = node.status === 'completed';
  const hasChildren = node.children.length > 0;

  return (
    <div className={isLast ? styles.treeBranchLast : styles.treeBranch}>
      <div className={styles.treeRow} onClick={() => onNavigate(node.identifier)}>
        {done ? (
          <div className={styles.subtaskCircleDone}>
            <Check color={cssVar.colorTextLightSolid} size={10} strokeWidth={3} />
          </div>
        ) : (
          <div className={styles.subtaskCircle} />
        )}
        <Text
          ellipsis
          style={{
            color: done ? cssVar.colorTextQuaternary : undefined,
            flex: 1,
            textDecoration: done ? 'line-through' : undefined,
          }}
        >
          {node.name || node.identifier}
        </Text>
      </div>
      {hasChildren && (
        <div>
          {node.children.map((child, i) => (
            <SubtaskTreeItem
              isLast={i === node.children.length - 1}
              key={child.identifier}
              node={child}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const TaskSubtasks = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);

  const [collapsed, setCollapsed] = useState(false);
  const [treeNodes, setTreeNodes] = useState<TaskTreeNode[]>([]);

  useEffect(() => {
    setTreeNodes([]);

    if (!taskId || subtasks.length === 0) return;

    taskService
      .getTaskTree(taskId)
      .then((res) => {
        const items = res.data as any[];
        const root = items.find((item: any) => item.identifier === taskId || item.id === taskId);
        if (!root) return;
        const built = buildTaskTree(items, root.id);
        if (built.length > 0) setTreeNodes(built);
      })
      .catch((err) => {
        // Fallback to flat list on error
        console.error('[TaskSubtasks] Failed to load task tree', err);
        setTreeNodes(
          subtasks.map((s) => ({
            children: [],
            identifier: s.identifier,
            name: s.name ?? null,
            status: s.status,
          })),
        );
      });
  }, [taskId, subtasks]);

  const { completed: completedCount, total: totalCount } = useMemo(
    () =>
      treeNodes.length > 0
        ? countTreeNodes(treeNodes)
        : {
            completed: subtasks.filter((s) => s.status === 'completed').length,
            total: subtasks.length,
          },
    [treeNodes, subtasks],
  );

  const handleNavigate = useCallback(
    (identifier: string) => {
      if (agentId) navigate(`/agent/${agentId}/tasks/${identifier}`);
    },
    [agentId, navigate],
  );

  if (subtasks.length === 0) return null;

  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Flexbox gap={0} style={{ marginBlockStart: 16 }}>
      <Flexbox
        horizontal
        align="center"
        className={styles.subtaskHeader}
        gap={8}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon
          icon={collapsed ? ChevronRight : ChevronDown}
          size={12}
          style={{ color: cssVar.colorTextTertiary }}
        />
        <Text style={{ fontSize: cssVar.fontSizeSM }} weight="bold">
          {t('taskDetail.subtasks')}
        </Text>
        <Progress
          percent={percent}
          showInfo={false}
          size={14}
          strokeColor={cssVar.colorPrimary}
          type="circle"
        />
        <Text style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}>
          {completedCount}/{totalCount}
        </Text>
      </Flexbox>

      {!collapsed && (
        <div style={{ paddingInlineStart: 22 }}>
          {treeNodes.length > 0 ? (
            treeNodes.map((node, i) => (
              <SubtaskTreeItem
                isLast={i === treeNodes.length - 1}
                key={node.identifier}
                node={node}
                onNavigate={handleNavigate}
              />
            ))
          ) : (
            <Flexbox align="center" style={{ paddingBlock: 16 }}>
              <Spin size="small" />
            </Flexbox>
          )}
        </div>
      )}
    </Flexbox>
  );
});

export default TaskSubtasks;
