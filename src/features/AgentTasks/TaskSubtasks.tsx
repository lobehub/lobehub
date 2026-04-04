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

const TaskSubtasks = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const [collapsed, setCollapsed] = useState(false);

  const completedCount = useMemo(
    () => subtasks.filter((s) => s.status === 'completed').length,
    [subtasks],
  );

  const handleClick = useCallback(
    (identifier: string) => {
      if (agentId) navigate(`/agent/${agentId}/tasks/${identifier}`);
    },
    [agentId, navigate],
  );

  if (subtasks.length === 0) return null;

  const percent = Math.round((completedCount / subtasks.length) * 100);

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
          {completedCount}/{subtasks.length}
        </Text>
      </Flexbox>

      {!collapsed &&
        subtasks.map((sub) => {
          const done = sub.status === 'completed';
          return (
            <div
              className={styles.subtaskRow}
              key={sub.identifier}
              onClick={() => handleClick(sub.identifier)}
            >
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
                {sub.name || sub.identifier}
              </Text>
              {sub.blockedBy && (
                <Text style={{ color: cssVar.colorTextQuaternary, fontSize: cssVar.fontSizeSM }}>
                  {t('taskDetail.blockedBy', { id: sub.blockedBy })}
                </Text>
              )}
            </div>
          );
        })}
    </Flexbox>
  );
});

export default TaskSubtasks;
