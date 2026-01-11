'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Accordion, AccordionItem, ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';

import CronTopicGroup from './CronTopicGroup';

interface CronTopicListProps {
  itemKey: string;
}

const CronTopicList = memo<CronTopicListProps>(({ itemKey }) => {
  const { t } = useTranslation('setting');
  const router = useQueryRoute();
  const [agentId, createAgentCronJob, useFetchCronTopicsWithJobInfo] = useAgentStore((s) => [
    s.activeAgentId,
    s.createAgentCronJob,
    s.useFetchCronTopicsWithJobInfo,
  ]);
  const { data: cronTopicsGroupsWithJobInfo = [], isLoading } =
    useFetchCronTopicsWithJobInfo(agentId);

  const handleCreateCronJob = useCallback(async () => {
    if (!agentId) return;

    const cronJobId = await createAgentCronJob();
    if (cronJobId) {
      router.push(urlJoin('/agent', agentId, 'cron', cronJobId));
    }
  }, [agentId, createAgentCronJob, router]);

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

  const totalCronJobs = cronTopicsGroupsWithJobInfo.length;

  return (
    <AccordionItem
      action={addAction}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={4} horizontal>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('agentCronJobs.title')}
          </Text>
          {totalCronJobs > 0 && (
            <Text fontSize={11} type="secondary">
              {totalCronJobs}
            </Text>
          )}
        </Flexbox>
      }
    >
      <Accordion defaultExpandedKeys={cronTopicsGroupsWithJobInfo.map((g) => g.cronJobId)} gap={2}>
        {cronTopicsGroupsWithJobInfo.map((group) => (
          <CronTopicGroup
            cronJob={group.cronJob}
            cronJobId={group.cronJobId}
            key={group.cronJobId}
            topics={group.topics}
          />
        ))}
      </Accordion>
    </AccordionItem>
  );
});

export default CronTopicList;
