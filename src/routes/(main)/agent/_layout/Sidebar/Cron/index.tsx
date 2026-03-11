'use client';

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
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import CronTopicGroup from './CronTopicGroup';

interface CronTopicListProps {
  itemKey: string;
}

const CronTopicList = memo<CronTopicListProps>(({ itemKey }) => {
  const { t } = useTranslation('setting');
  const router = useQueryRoute();
  const [agentId, useFetchCronTopicsWithJobInfo] = useAgentStore((s) => [
    s.activeAgentId,
    s.useFetchCronTopicsWithJobInfo,
  ]);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { data: cronTopicsGroupsWithJobInfo = [], isLoading } = useFetchCronTopicsWithJobInfo(
    agentId,
    enableBusinessFeatures,
  );

  const handleCreateCronJob = useCallback(() => {
    if (!agentId) return;
    router.push(urlJoin('/agent', agentId, 'cron', 'new'));
  }, [agentId, router]);

  if (!enableBusinessFeatures) return null;

  const addAction = (
    <ActionIcon
      disabled={!agentId}
      icon={Plus}
      size={'small'}
      title={t('agentCronJobs.addJob')}
      onClick={handleCreateCronJob}
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
          <Flexbox horizontal align="center" gap={4}>
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
          <Flexbox horizontal align="center" gap={4}>
            <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
              {t('agentCronJobs.title')}
            </Text>
          </Flexbox>
        }
      >
        <EmptyNavItem title={t('agentCronJobs.addJob')} onClick={handleCreateCronJob} />
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
        <Flexbox horizontal align="center" gap={4}>
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
