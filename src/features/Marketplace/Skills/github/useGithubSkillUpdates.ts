import type { GitHubSkillCheck } from '@lobechat/types';
import { confirmModal } from '@lobehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

const QUERY_KEY = ['market', 'githubSkillUpdates'];

/**
 * Whether each skill installed from GitHub has a newer version there, by skill
 * id. One check covers the whole library (the server groups skills by repository
 * and ref), so it runs only while a list of GitHub skills is on screen, and
 * stays fresh for ten minutes.
 */
export const useGithubSkillUpdates = (enabled: boolean) =>
  useQuery({
    enabled,
    queryFn: () => agentSkillService.checkGitHubUpdates(),
    queryKey: QUERY_KEY,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

/**
 * Take the update a check found for one skill. A skill changed here since it
 * was installed asks before GitHub's version replaces those changes.
 */
export const useApplyGithubUpdate = (id: string, check: GitHubSkillCheck | undefined) => {
  const { t } = useTranslation('setting');
  const queryClient = useQueryClient();
  const refresh = useToolStore((s) => s.refreshAgentSkills);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const run = useCallback(
    async (overwriteLocal: boolean) => {
      if (check?.status !== 'update') return;
      setPending(true);
      setError(false);
      try {
        await agentSkillService.applyGitHubUpdate({
          commit: check.commit,
          id,
          overwriteLocal,
          revision: check.revision,
        });
        await refresh();
        await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      } catch (cause) {
        console.warn('[Market] Failed to update GitHub skill:', cause);
        setError(true);
      } finally {
        setPending(false);
      }
    },
    [check, id, queryClient, refresh],
  );

  const update = useCallback(() => {
    if (check?.status !== 'update') return;
    if (!check.localChanges) return void run(false);
    confirmModal({
      cancelText: t('market.skills.github.localChanges.cancel'),
      content: t('market.skills.github.localChanges.content'),
      okButtonProps: { danger: true },
      okText: t('market.skills.github.localChanges.ok'),
      onOk: () => run(true),
      title: t('market.skills.github.localChanges.title'),
    });
  }, [check, run, t]);

  return { error, pending, update };
};
