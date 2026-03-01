import { message } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  type CreateAgentCronJobData,
  type UpdateAgentCronJobData,
} from '@/database/schemas/agentCronJob';
import { agentCronJobService } from '@/services/agentCronJob';

export const useAgentCronJobs = (agentId?: string, enabled: boolean = true) => {
  const { t } = useTranslation('setting');

  // Fetch cron jobs for the agent
  const {
    data: cronJobs,
    error,
    isLoading: loading,
    mutate,
  } = useSWR(
    enabled && agentId ? `/api/agent-cron-jobs/${agentId}` : null,
    enabled && agentId ? () => agentCronJobService.getByAgentId(agentId) : null,
    {
      onError: (error) => {
        console.error('Failed to fetch cron jobs:', error);
        message.error('Failed to load scheduled tasks');
      },
    },
  );

  // Create a new cron job
  const createCronJob = useCallback(
    async (data: Omit<CreateAgentCronJobData, 'userId'>) => {
      if (!agentId) return;

      try {
        const result = await agentCronJobService.create({
          ...data,
          agentId,
        });

        if (result.success) {
          message.success(t('agentCronJobs.createSuccess'));
          await mutate();
          return result.data;
        }
      } catch (error) {
        console.error('Failed to create cron job:', error);
        message.error('Failed to create scheduled task');
        throw error;
      }
    },
    [agentId, mutate, t],
  );

  // Update a cron job
  const updateCronJob = useCallback(
    async (id: string, data: UpdateAgentCronJobData) => {
      try {
        const result = await agentCronJobService.update(id, data);

        if (result.success) {
          message.success(t('agentCronJobs.updateSuccess'));
          await mutate();
          return result.data;
        }
      } catch (error) {
        console.error('Failed to update cron job:', error);
        message.error('Failed to update scheduled task');
        throw error;
      }
    },
    [mutate, t],
  );

  // Delete a cron job
  const deleteCronJob = useCallback(
    async (id: string) => {
      try {
        const result = await agentCronJobService.delete(id);

        if (result.success) {
          message.success(t('agentCronJobs.deleteSuccess'));
          await mutate();
        }
      } catch (error) {
        console.error('Failed to delete cron job:', error);
        message.error('Failed to delete scheduled task');
        throw error;
      }
    },
    [mutate, t],
  );

  // Get execution statistics
  const getStats = useCallback(async () => {
    try {
      return await agentCronJobService.getStats();
    } catch (error) {
      console.error('Failed to get cron job stats:', error);
      throw error;
    }
  }, []);

  // Reset execution counts
  const resetExecutions = useCallback(
    async (id: string, newMaxExecutions?: number) => {
      try {
        const result = await agentCronJobService.resetExecutions(id, newMaxExecutions);

        if (result.success) {
          message.success('Execution counts reset successfully');
          await mutate();
          return result.data;
        }
      } catch (error) {
        console.error('Failed to reset executions:', error);
        message.error('Failed to reset execution counts');
        throw error;
      }
    },
    [mutate],
  );

  return {
    createCronJob,
    cronJobs: cronJobs?.data || [],
    deleteCronJob,
    error,
    getStats,
    loading,
    refetch: mutate,
    resetExecutions,
    updateCronJob,
  };
};
