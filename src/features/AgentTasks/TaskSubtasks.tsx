import type { TaskDetailSubtask } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';

/** Count all nodes recursively */
const countNodes = (nodes: TaskDetailSubtask[]): { completed: number; total: number } => {
  let total = 0;
  let completed = 0;
  const walk = (list: TaskDetailSubtask[]) => {
    for (const node of list) {
      total++;
      if (node.status === 'completed') completed++;
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return { completed, total };
};

/**
 * Recursive tree item with Linear-style connecting lines.
 *
 * Line model per child wrapper:
 * - Non-last child: full-height border-left (vertical line continues)
 * - Last child: border-left only to row center (L-shape, line stops)
 */
const SubtaskTreeItem = memo<{
  isLast: boolean;
  node: TaskDetailSubtask;
  onNavigate: (identifier: string) => void;
}>(({ node, isLast, onNavigate }) => {
  const done = node.status === 'completed';
  const children = node.children;
  const hasChildren = children && children.length > 0;

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
          {children.map((child, i) => (
            <SubtaskTreeItem
              isLast={i === children.length - 1}
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
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);

  const [collapsed, setCollapsed] = useState(false);

  const { completed: completedCount, total: totalCount } = useMemo(
    () => countNodes(subtasks),
    [subtasks],
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
          {subtasks.map((node, i) => (
            <SubtaskTreeItem
              isLast={i === subtasks.length - 1}
              key={node.identifier}
              node={node}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

export default TaskSubtasks;
