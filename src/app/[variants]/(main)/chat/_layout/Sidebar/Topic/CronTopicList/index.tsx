'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AccordionItem, ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { message } from 'antd';
import { Calendar, Plus } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useFetchCronTopicsWithJobInfo } from '@/hooks/useFetchCronTopicsWithJobInfo';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { agentCronJobService } from '@/services/agentCronJob';
import { useAgentStore } from '@/store/agent';

import CronTopicGroup from './CronTopicGroup';

interface CronTopicListProps {
  itemKey: string;
}

const CronTopicList = memo<CronTopicListProps>(({ itemKey }) => {
  const { t } = useTranslation('setting');
  const router = useQueryRoute();
  const agentId = useAgentStore((s) => s.activeAgentId);
  const { cronTopicsGroupsWithJobInfo, isLoading, mutate } = useFetchCronTopicsWithJobInfo();
  const totalTopics = cronTopicsGroupsWithJobInfo.reduce(
    (acc, group) => acc + group.topics.length,
    0,
  );

  const handleCreateCronJob = useCallback(async () => {
    if (!agentId) return;
    try {
      const result = await agentCronJobService.create({
        agentId,
        content: t('agentCronJobs.form.content.placeholder') || 'This is a cron job',
        cronPattern: '*/30 * * * *',
        enabled: true,
        name: t('agentCronJobs.addJob') || 'Cron Job Task',
      });

      if (result.success) {
        await mutate();
        router.push(urlJoin('/agent', agentId, 'cron', result.data.id));
      }
    } catch (error) {
      console.error('Failed to create cron job:', error);
      message.error('Failed to create scheduled task');
    }
  }, [agentId, mutate, router, t]);

  if (!ENABLE_BUSINESS_FEATURES) return null;

  const addAction = (
    <ActionIcon
      disabled={!agentId}
      icon={Plus}
      onClick={handleCreateCronJob}
      size={'small'}
      title={t('agentCronJobs.addJob')}
    />
  );

  if (isLoading) {
    return (
      <AccordionItem
        action={addAction}
        itemKey={itemKey}
        paddingBlock={4}
        paddingInline={'8px 4px'}
        title={
          <Flexbox align="center" gap={4} horizontal>
            <Icon icon={Calendar} size={12} />
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('agentCronJobs.title')}
            </Text>
            <NeuralNetworkLoading size={14} />
          </Flexbox>
        }
      >
        <SkeletonList />
      </AccordionItem>
    );
  }

  if (cronTopicsGroupsWithJobInfo.length === 0) {
    return (
      <AccordionItem
        action={addAction}
        itemKey={itemKey}
        paddingBlock={4}
        paddingInline={'8px 4px'}
        title={
          <Flexbox align="center" gap={4} horizontal>
            <Icon icon={Calendar} size={12} />
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('agentCronJobs.title')}
            </Text>
          </Flexbox>
        }
      >
        <EmptyNavItem onClick={handleCreateCronJob} title={t('agentCronJobs.addJob')} />
      </AccordionItem>
    );
  }

  return (
    <AccordionItem
      action={addAction}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={4} horizontal>
          <Icon icon={Calendar} size={12} />
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {`${t('agentCronJobs.title')} ${totalTopics > 0 ? totalTopics : ''}`}
          </Text>
        </Flexbox>
      }
    >
      <Flexbox gap={2} paddingBlock={2}>
        {cronTopicsGroupsWithJobInfo.map((group) => (
          <CronTopicGroup
            cronJob={group.cronJob}
            cronJobId={group.cronJobId}
            key={group.cronJobId}
            topics={group.topics}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default CronTopicList;
