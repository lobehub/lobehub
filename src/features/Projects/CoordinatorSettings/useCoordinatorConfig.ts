import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import type { ProjectCoordinatorConfigPatch } from '@/services/project';
import { projectService } from '@/services/project';
import { useAgentStore } from '@/store/agent';

export const coordinatorConfigKey = (projectId: string) =>
  ['project:coordinatorConfig', projectId] as const;

export type ProjectCoordinatorConfig = NonNullable<
  Awaited<ReturnType<typeof projectService.getCoordinatorConfig>>
>;

/**
 * The project's main agent configuration as the project resolves it — the
 * owned coordinator first, else the linked agent, else LobeAI — read through
 * `project.getCoordinatorConfig`, the authority after the ownership backfill.
 */
export const useCoordinatorConfig = (projectId: string) =>
  useClientDataSWR(coordinatorConfigKey(projectId), () =>
    projectService.getCoordinatorConfig(projectId),
  );

/**
 * Saves part of the coordinator's configuration through
 * `project.updateCoordinatorConfig`, then puts the read-back value in the
 * cache. The agent store copy of the same row is refreshed too, so the
 * embedded editors and the conversation pick up the change without a reload.
 */
export const useSaveCoordinatorConfig = (projectId: string) => {
  const { t } = useTranslation('project');
  const { data, mutate } = useCoordinatorConfig(projectId);
  const [saving, setSaving] = useState<string | undefined>();

  const save = async (
    key: string,
    input: { config?: ProjectCoordinatorConfigPatch; responsibility?: string | null },
  ) => {
    setSaving(key);
    try {
      const next = await projectService.updateCoordinatorConfig(projectId, input);
      await mutate(next, { revalidate: false });
      const agentId = next?.agentId ?? data?.agentId;
      if (agentId) await useAgentStore.getState().internal_refreshAgentConfig(agentId);
      toast.success(t('settings.saved'));
      return next;
    } catch (error) {
      console.error('Failed to update project main agent', error);
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(undefined);
    }
  };

  return { save, saving };
};
