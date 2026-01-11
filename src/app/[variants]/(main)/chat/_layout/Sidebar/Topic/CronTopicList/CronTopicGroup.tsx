'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Clock } from 'lucide-react';
import { type MouseEvent, memo, useCallback } from 'react';
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
  const { aid } = useParams<{ aid?: string }>();
  const router = useRouter();
  const handleOpenCronJob = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      if (!aid) return;
      router.push(`/agent/${aid}/cron/${cronJobId}`);
    },
    [aid, cronJobId, router],
  );

  const cronJobName = cronJob?.name || `Cron Job ${cronJobId.slice(-8)}`;
  const isEnabled = cronJob?.enabled ?? false;

  return (
    <Flexbox gap={1}>
      <Flexbox
        align="center"
        gap={6}
        height={24}
        horizontal
        onClick={handleOpenCronJob}
        paddingInline={8}
        style={{ cursor: 'pointer', opacity: isEnabled ? 1 : 0.6, overflow: 'hidden' }}
      >
        <Icon icon={Clock} style={{ color: cssVar.colorTextDescription, opacity: 0.7 }} />
        <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
          {cronJobName}
        </Text>
        {topics.length > 0 && (
          <Text style={{ color: cssVar.colorTextDescription, fontSize: 11 }}>{topics.length}</Text>
        )}
      </Flexbox>
      {topics.length > 0 && (
        <Flexbox gap={1} paddingBlock={1}>
          {topics.map((topic) => (
            <CronTopicItem key={topic.id} topic={topic} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default CronTopicGroup;
