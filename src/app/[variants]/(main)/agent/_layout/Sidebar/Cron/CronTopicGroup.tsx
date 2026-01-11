'use client';

import { Block, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Clock } from 'lucide-react';
import { type MouseEvent, memo, useCallback } from 'react';
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

  const cronJobName = cronJob?.name || t('agentCronJobs.unnamedTask');
  const isEnabled = cronJob?.enabled ?? false;

  return (
    <Flexbox gap={2}>
      <Block
        align="center"
        clickable
        gap={8}
        height={32}
        horizontal
        onClick={handleOpenCronJob}
        paddingInline={4}
        style={{ opacity: isEnabled ? 1 : 0.5, overflow: 'hidden' }}
        variant="borderless"
      >
        <Center flex="none" height={24} width={24}>
          <Icon color={cssVar.colorTextDescription} icon={Clock} size={16} />
        </Center>
        <Text ellipsis fontSize={12} style={{ flex: 1 }} type="secondary" weight={500}>
          {cronJobName}
        </Text>
        {topics.length > 0 && (
          <Text style={{ color: cssVar.colorTextDescription, fontSize: 11 }}>{topics.length}</Text>
        )}
      </Block>
      {topics.length > 0 && (
        <Flexbox gap={2} paddingBlock={2}>
          {topics.map((topic) => (
            <CronTopicItem key={topic.id} topic={topic} />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default CronTopicGroup;
