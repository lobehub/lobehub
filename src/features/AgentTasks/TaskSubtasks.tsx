import { Flexbox, Tag, Text } from '@lobehub/ui';
import { Badge } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors, taskListSelectors } from '@/store/task/selectors';

import { styles } from './style';

const statusBadgeMap: Record<string, 'success' | 'processing' | 'warning' | 'default'> = {
  backlog: 'default',
  completed: 'success',
  failed: 'warning',
  paused: 'warning',
  running: 'processing',
};

const TaskSubtasks = memo(() => {
  const { t } = useTranslation('chat');
  const subtasks = useTaskStore(taskDetailSelectors.activeTaskSubtasks);

  if (subtasks.length === 0) return null;

  return (
    <div className={styles.section}>
      <Flexbox horizontal align="center" gap={8}>
        <Text className={styles.sectionTitle}>{t('taskDetail.subtasks')}</Text>
        <Tag>{`${subtasks.length}`}</Tag>
      </Flexbox>
      <Flexbox>
        {subtasks.map((sub) => (
          <div className={styles.subtaskItem} key={sub.identifier}>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Text ellipsis weight="bold">
                {sub.name || sub.identifier}
              </Text>
              {sub.blockedBy && (
                <Text style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM }}>
                  Blocked by {sub.blockedBy}
                </Text>
              )}
            </Flexbox>
            <Badge
              status={statusBadgeMap[sub.status] ?? 'default'}
              text={taskListSelectors.getDisplayStatus(sub.status)}
            />
          </div>
        ))}
      </Flexbox>
    </div>
  );
});

export default TaskSubtasks;
