'use client';

import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { LOBE_BENCH_PATH } from '@/features/LobeBench/lobeBench';
import { useLobeBenchExperiments } from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentEvalService } from '@/services/agentEval';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { forgetExperimentLaunch, isExperimentLaunching } from './launchBackground';

interface DeleteExperimentOptions {
  /** A run is still in flight: refuse and say to stop the experiment first. */
  active?: boolean;
  /** The experiment's own page is open: go back to the overview once it is gone. */
  leave?: boolean;
}

/**
 * Confirms and deletes an experiment the Lobe Bench way: the experiment owns its runs, so
 * the runs, their per-case results and Judge verdicts go with it and the leaderboard is
 * computed without them. Shared by the experiment page header and the sidebar row menu.
 */
export const useDeleteExperiment = () => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const userId = useUserStore(userProfileSelectors.userId);
  const workspaceId = useActiveWorkspaceId();
  const { mutate } = useLobeBenchExperiments();

  return (
    experiment: { id: string; name?: string | null },
    { active, leave }: DeleteExperimentOptions = {},
  ) => {
    if (active || isExperimentLaunching(experiment.id)) {
      toast.error(t('lobeBench.experiment.delete.active'));
      return;
    }
    confirmModal({
      content: t('lobeBench.experiment.delete.confirm', {
        name: experiment.name || t('lobeBench.experiment.unnamed'),
      }),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        if (isExperimentLaunching(experiment.id)) {
          toast.error(t('lobeBench.experiment.delete.active'));
          return;
        }
        const result = await agentEvalService.deleteExperiment(experiment.id, { withRuns: true });
        if (result.success === false) {
          toast.error(result.error || t('lobeBench.experiment.delete.failed'));
          return;
        }
        if (userId) forgetExperimentLaunch(userId, workspaceId, experiment.id);
        toast.success(t('lobeBench.experiment.delete.done'));
        await mutate();
        if (leave) navigate(LOBE_BENCH_PATH);
      },
      title: t('lobeBench.experiment.delete'),
    });
  };
};
