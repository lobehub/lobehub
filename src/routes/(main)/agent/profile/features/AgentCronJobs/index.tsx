'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { Clock } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import CronJobCards from './CronJobCards';
import { useAgentCronJobs } from './hooks/useAgentCronJobs';

const { Title } = Typography;

const AgentCronJobs = memo(() => {
  const { t } = useTranslation('setting');
  const agentId = useAgentStore((s) => s.activeAgentId);
  const router = useQueryRoute();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const { cronJobs, loading, deleteCronJob } = useAgentCronJobs(agentId, enableBusinessFeatures);

  // Edit: Navigate to cron job detail page
  const handleEdit = useCallback(
    (jobId: string) => {
      if (!agentId) return;
      router.push(urlJoin('/agent', agentId, 'cron', jobId));
    },
    [agentId, router],
  );

  // Delete: Keep the existing delete logic
  const handleDelete = useCallback(
    async (jobId: string) => {
      await deleteCronJob(jobId);
    },
    [deleteCronJob],
  );

  if (!enableBusinessFeatures) return null;

  if (!agentId) {
    return null;
  }

  const hasCronJobs = cronJobs && cronJobs.length > 0;

  // Only show if there are jobs
  if (!hasCronJobs) {
    return null;
  }

  return (
    <Flexbox gap={12} style={{ marginBottom: 16, marginTop: 16 }}>
      <Title level={5} style={{ margin: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Clock size={16} />
          {t('agentCronJobs.title')}
        </Flexbox>
      </Title>

      <CronJobCards
        cronJobs={cronJobs}
        loading={loading}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />
    </Flexbox>
  );
});

export default AgentCronJobs;
