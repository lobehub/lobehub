import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { MessageCircle, MessagesSquare, Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskActivitySelectors } from '@/store/task/selectors';

import { styles } from './style';

const typeIconMap = {
  brief: Zap,
  comment: MessageCircle,
  topic: MessagesSquare,
};

const TaskActivities = memo(() => {
  const { t } = useTranslation('chat');
  const activities = useTaskStore(taskActivitySelectors.activeTaskActivities);

  if (activities.length === 0) return null;

  return (
    <div className={styles.section}>
      <Text className={styles.sectionTitle}>{t('taskDetail.activities')}</Text>
      <Flexbox>
        {activities.map((act, index) => {
          const time = act.time ? dayjs(act.time).fromNow() : '';
          const LucideIcon = typeIconMap[act.type] ?? MessageCircle;

          return (
            <div className={styles.activityItem} key={act.id ?? index}>
              <Flexbox horizontal align="flex-start" gap={10}>
                <Icon
                  icon={LucideIcon}
                  size={16}
                  style={{ color: cssVar.colorTextTertiary, flexShrink: 0, marginBlockStart: 2 }}
                />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align="center" gap={6}>
                    <Text ellipsis weight="bold">
                      {act.title || act.content || act.type}
                    </Text>
                    {time && (
                      <Text
                        style={{
                          color: cssVar.colorTextTertiary,
                          flexShrink: 0,
                          fontSize: cssVar.fontSizeSM,
                        }}
                      >
                        {time}
                      </Text>
                    )}
                  </Flexbox>
                  {act.summary && (
                    <Text
                      ellipsis
                      style={{ color: cssVar.colorTextDescription, fontSize: cssVar.fontSizeSM }}
                    >
                      {act.summary}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            </div>
          );
        })}
      </Flexbox>
    </div>
  );
});

export default TaskActivities;
