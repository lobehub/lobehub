'use client';

import { AccordionItem, ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Settings2Icon, TimerIcon, TimerOffIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { useRouter } from '@/app/[variants]/(main)/hooks/useRouter';
import type { AgentCronJob } from '@/database/schemas/agentCronJob';

import CronTopicItem from './CronTopicItem';

interface CronTopicGroupProps {
  cronJob: AgentCronJob | null;
  cronJobId: string;
  topics: Array<{
    createdAt: Date | string;
    favorite?: boolean | null;
    historySummary?: string | null;
    id: string;
    metadata?: any;
    title?: string | null;
    trigger?: string | null;
    updatedAt: Date | string;
  }>;
}

const CronTopicGroup = memo<CronTopicGroupProps>(({ cronJob, cronJobId, topics }) => {
  const { t } = useTranslation('setting');
  const { aid, cronId } = useParams<{ aid?: string; cronId?: string }>();
  const router = useRouter();

  const handleOpenCronJob = useCallback(() => {
    if (!aid) return;
    router.push(`/agent/${aid}/cron/${cronJobId}`);
  }, [aid, cronJobId, router]);

  const cronJobName = cronJob?.name || t('agentCronJobs.unnamedTask');
  const isEnabled = cronJob?.enabled ?? false;
  const isActive = cronId === cronJobId;

  return (
    <AccordionItem
      action={
        <ActionIcon
          icon={Settings2Icon}
          onClick={handleOpenCronJob}
          size="small"
          title={t('agentCronJobs.editJob')}
        />
      }
      itemKey={cronJobId}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={6} height={24} horizontal style={{ overflow: 'hidden' }}>
          <Icon icon={isEnabled ? TimerIcon : TimerOffIcon} style={{ opacity: 0.5 }} />
          <Text ellipsis style={{ flex: 1 }} type={isActive ? undefined : 'secondary'}>
            {cronJobName}
          </Text>
          {topics.length > 0 && (
            <Text fontSize={11} type="secondary">
              {topics.length}
            </Text>
          )}
        </Flexbox>
      }
      variant={isActive ? 'filled' : 'borderless'}
    >
      <Flexbox gap={1} paddingBlock={1}>
        {topics.length > 0 ? (
          topics.map((topic) => <CronTopicItem key={topic.id} topic={topic} />)
        ) : (
          <Text fontSize={12} style={{ padding: '8px 12px' }} type="secondary">
            {t('agentCronJobs.noExecutionResults')}
          </Text>
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default CronTopicGroup;
