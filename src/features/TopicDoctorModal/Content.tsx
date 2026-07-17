'use client';

import type { TopicIssue } from '@lobechat/conversation-flow';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, useModalContext } from '@lobehub/ui/base-ui';
import { Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleAlert, CircleCheck, EyeOff, Stethoscope } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { messageService } from '@/services/message';
import { useChatStore } from '@/store/chat';

export interface TopicDoctorContentProps {
  agentId?: string | null;
  topicId: string;
}

const styles = createStaticStyles(({ css }) => ({
  issue: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
  `,
}));

const TopicDoctorContent = memo<TopicDoctorContentProps>(({ agentId, topicId }) => {
  const { t } = useTranslation(['topic', 'common']);
  const { close } = useModalContext();
  const refreshMessages = useChatStore((s) => s.refreshMessages);

  const [repairing, setRepairing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(['topic-doctor', agentId, topicId], () =>
    messageService.diagnoseTopic({ agentId, topicId }),
  );

  if (isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;

  // Without this the check failing would leave the skeleton up forever: SWR clears `isLoading`
  // but never produces `data`, so a `!data` skeleton has no way back.
  if (error || !data)
    return (
      <Flexbox align={'center'} gap={12} paddingBlock={24}>
        <Icon color={cssVar.colorError} icon={CircleAlert} size={32} />
        <Text>{t('doctor.checkFailed')}</Text>
        <Button onClick={() => mutate()}>{t('retry', { ns: 'common' })}</Button>
      </Flexbox>
    );

  const { hiddenCount, issues, patch } = data;

  if (issues.length === 0)
    return (
      <Flexbox align={'center'} gap={12} paddingBlock={24}>
        <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={32} />
        <Text>{t('doctor.healthy')}</Text>
      </Flexbox>
    );

  const describe = (issue: TopicIssue) => {
    const count = issue.hiddenMessageIds.length;
    switch (issue.kind) {
      case 'concurrent-fork': {
        return t('doctor.issue.concurrent-fork', { count });
      }
      case 'stale-branch-index': {
        return t('doctor.issue.stale-branch-index', { count });
      }
      case 'orphan-signal-turn': {
        return t('doctor.issue.orphan-signal-turn', { count });
      }
      // Nothing is hidden here — the section renders, but on its own root: out of order and
      // cut off from the model's context. The count is the section being reconnected.
      case 'segment-split': {
        return t('doctor.issue.segment-split', {
          count: issue.reattachedMessageIds?.length ?? 0,
        });
      }
      // The one shape that cannot be undone: these rows reached the database with nothing in
      // them, so the text is simply gone.
      case 'lost-content': {
        return t('doctor.issue.lostContent', { count: issue.lostMessageIds?.length ?? 0 });
      }
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const { restoredMessageIds } = await messageService.repairTopic({ agentId, topicId });
      await refreshMessages({ agentId: agentId ?? undefined, topicId });
      message.success(t('doctor.repaired', { count: restoredMessageIds.length }));
      close();
    } catch {
      message.error(t('doctor.repairFailed'));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {hiddenCount > 0 && (
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorWarning} icon={EyeOff} />
          <Text>{t('doctor.summary', { count: hiddenCount })}</Text>
        </Flexbox>
      )}

      <Flexbox gap={8}>
        {issues.map((issue) => (
          <Flexbox
            horizontal
            align={'flex-start'}
            className={styles.issue}
            gap={8}
            key={issue.messageId}
          >
            <Icon
              color={issue.repairable ? cssVar.colorWarning : cssVar.colorTextQuaternary}
              icon={CircleAlert}
            />
            <Flexbox gap={2}>
              <Text>{describe(issue)}</Text>
              {!issue.repairable && <Text type={'secondary'}>{t('doctor.notRepairable')}</Text>}
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('cancel', { ns: 'common' })}</Button>
        <Button
          disabled={patch.length === 0}
          icon={Stethoscope}
          loading={repairing}
          type={'primary'}
          onClick={handleRepair}
        >
          {t('doctor.repair')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

TopicDoctorContent.displayName = 'TopicDoctorContent';

export default TopicDoctorContent;
