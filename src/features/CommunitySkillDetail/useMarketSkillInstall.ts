'use client';

import { toast } from '@lobehub/ui';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

/**
 * Install a market skill into the user's library. Shared by the skill detail
 * header and the Marketplace catalog rows (the Codex `+`), so both report the
 * same installed state and the same failure toast.
 * The caller keeps the installed skills fetched (`useFetchAgentSkills(true)`).
 */
export const useMarketSkillInstall = (identifier?: string, name?: string) => {
  const { t } = useTranslation('plugin');
  const [installing, setInstalling] = useState(false);
  const { allowed: canCreate } = usePermission('create_content');

  const installedSkillId = useToolStore(
    (s) => agentSkillsSelectors.getAgentSkillByIdentifier(identifier || '')(s)?.id,
  );
  const refreshAgentSkills = useToolStore((s) => s.refreshAgentSkills);

  const install = useCallback(async () => {
    if (!identifier || !canCreate || installing || installedSkillId) return;
    setInstalling(true);
    try {
      await agentSkillService.importFromMarket(identifier);
      await refreshAgentSkills();
    } catch {
      // The control falls back to Install (clicking again retries) — say why
      toast.error(t('error.installError', { name: name || identifier }));
    } finally {
      setInstalling(false);
    }
  }, [canCreate, identifier, installing, installedSkillId, name, refreshAgentSkills, t]);

  return { canCreate, install, installedSkillId, installing };
};
