import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Popover, Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';

interface SiblingTask {
  identifier: string;
  name: string | null;
  status: string;
}

const TaskParentBar = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const parent = useTaskStore(taskDetailSelectors.activeTaskParent);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const currentIdentifier = useTaskStore(taskDetailSelectors.activeTaskDetail)?.identifier;

  const [siblings, setSiblings] = useState<SiblingTask[]>([]);

  useEffect(() => {
    setSiblings([]);
    if (!parent?.identifier) return;
    taskService
      .getSubtasks(parent.identifier)
      .then((res) => {
        setSiblings(
          (res.data as SiblingTask[]).map((s) => ({
            identifier: s.identifier,
            name: s.name,
            status: s.status,
          })),
        );
      })
      .catch((err) => {
        console.error('[TaskParentBar] Failed to load siblings', err);
      });
  }, [parent?.identifier]);

  const { completedCount, percent } = useMemo(() => {
    const count = siblings.filter((s) => s.status === 'completed').length;
    return {
      completedCount: count,
      percent: siblings.length > 0 ? Math.round((count / siblings.length) * 100) : 0,
    };
  }, [siblings]);

  if (!parent) return null;

  const navigationContent = (
    <Flexbox gap={0} style={{ maxHeight: 320, minWidth: 260, overflowY: 'auto', padding: 4 }}>
      <Text
        style={{
          color: cssVar.colorTextTertiary,
          fontSize: cssVar.fontSizeSM,
          padding: '6px 10px 4px',
        }}
      >
        {t('taskDetail.navigation')}
      </Text>
      {siblings.map((sib) => {
        const isActive = sib.identifier === currentIdentifier;
        const done = sib.status === 'completed';
        return (
          <Flexbox
            horizontal
            align="center"
            className={styles.navItem}
            gap={8}
            key={sib.identifier}
            onClick={() => {
              if (agentId) navigate(`/agent/${agentId}/tasks/${sib.identifier}`);
            }}
          >
            <div className={done ? styles.subtaskCircleDone : styles.subtaskCircle}>
              {done && <Check color={cssVar.colorTextLightSolid} size={8} strokeWidth={3} />}
            </div>
            <Text
              style={{
                color: cssVar.colorTextTertiary,
                flexShrink: 0,
                fontSize: cssVar.fontSizeSM,
              }}
            >
              {sib.identifier}
            </Text>
            <Text ellipsis style={{ flex: 1, fontSize: cssVar.fontSizeSM }} weight="bold">
              {sib.name || sib.identifier}
            </Text>
            {isActive && <Icon icon={Check} size={14} style={{ color: cssVar.colorText }} />}
          </Flexbox>
        );
      })}
    </Flexbox>
  );

  return (
    <Flexbox horizontal align="center" className={styles.parentBar} gap={8}>
      <Text style={{ color: cssVar.colorTextTertiary }}>{t('taskDetail.subIssueOf')}</Text>
      <Flexbox
        horizontal
        align="center"
        className={styles.parentLink}
        gap={6}
        onClick={() => {
          if (agentId) navigate(`/agent/${agentId}/tasks/${parent.identifier}`);
        }}
      >
        <div className={styles.subtaskCircle} />
        <Text style={{ color: cssVar.colorTextSecondary }}>{parent.identifier}</Text>
        <Text weight="bold">{parent.name}</Text>
      </Flexbox>
      {siblings.length > 0 && (
        <Popover
          content={navigationContent}
          overlayInnerStyle={{ padding: 0 }}
          placement="rightTop"
          trigger="click"
        >
          <Flexbox
            horizontal
            align="center"
            gap={6}
            style={{ cursor: 'pointer', marginInlineStart: 4 }}
          >
            <Progress
              percent={percent}
              showInfo={false}
              size={16}
              strokeColor={cssVar.colorPrimary}
              type="circle"
            />
            <Text style={{ color: cssVar.colorTextTertiary }}>
              {completedCount}/{siblings.length}
            </Text>
          </Flexbox>
        </Popover>
      )}
    </Flexbox>
  );
});

export default TaskParentBar;
