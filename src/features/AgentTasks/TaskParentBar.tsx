import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Popover, Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
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
  const [loaded, setLoaded] = useState(false);

  const fetchSiblings = useCallback(async () => {
    if (!parent?.identifier || loaded) return;
    try {
      const res = await taskService.getSubtasks(parent.identifier);
      setSiblings(
        (res.data as SiblingTask[]).map((s) => ({
          identifier: s.identifier,
          name: s.name,
          status: s.status,
        })),
      );
      setLoaded(true);
    } catch {
      // ignore
    }
  }, [parent?.identifier, loaded]);

  useEffect(() => {
    setLoaded(false);
    setSiblings([]);
  }, [parent?.identifier]);

  if (!parent) return null;

  const completedCount = siblings.filter((s) => s.status === 'completed').length;
  const percent = siblings.length > 0 ? Math.round((completedCount / siblings.length) * 100) : 0;

  const navigationContent = (
    <Flexbox gap={2} style={{ maxHeight: 300, minWidth: 220, overflowY: 'auto' }}>
      <Text
        style={{
          color: cssVar.colorTextTertiary,
          fontSize: cssVar.fontSizeSM,
          padding: '6px 12px 4px',
        }}
      >
        {t('taskDetail.navigation')}
      </Text>
      {siblings.map((sib) => {
        const isActive = sib.identifier === currentIdentifier;
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
            <div
              className={
                sib.status === 'completed' ? styles.subtaskCircleDone : styles.subtaskCircle
              }
            >
              {sib.status === 'completed' && (
                <Check color={cssVar.colorTextLightSolid} size={8} strokeWidth={3} />
              )}
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
            <Text ellipsis style={{ flex: 1 }} weight="bold">
              {sib.name || sib.identifier}
            </Text>
            {isActive && (
              <Icon icon={Check} size={14} style={{ color: cssVar.colorTextTertiary }} />
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );

  return (
    <Popover
      content={navigationContent}
      placement="bottomLeft"
      trigger="click"
      onOpenChange={(open) => {
        if (open) fetchSiblings();
      }}
    >
      <Flexbox horizontal align="center" className={styles.parentBar} gap={6}>
        <Text style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM }}>
          {t('taskDetail.subIssueOf')}
        </Text>
        <div className={styles.subtaskCircle} style={{ height: 14, width: 14 }} />
        <Text style={{ fontSize: cssVar.fontSizeSM }} weight="bold">
          {parent.identifier}
        </Text>
        <Text ellipsis style={{ color: cssVar.colorTextSecondary, fontSize: cssVar.fontSizeSM }}>
          {parent.name}
        </Text>
        {loaded && siblings.length > 0 && (
          <>
            <Progress
              percent={percent}
              showInfo={false}
              size={14}
              strokeColor={cssVar.colorPrimary}
              type="circle"
            />
            <Text style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM }}>
              {completedCount}/{siblings.length}
            </Text>
          </>
        )}
      </Flexbox>
    </Popover>
  );
});

export default TaskParentBar;
