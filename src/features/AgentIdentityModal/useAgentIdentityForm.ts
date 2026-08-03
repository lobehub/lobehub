import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

interface UseAgentIdentityFormOptions {
  agentId: string;
  onSaved: () => void;
}

/**
 * Drives the three identity fields of the agent form.
 *
 * `name` and `title` ride the ordinary meta patch; `slug` has its own validated
 * endpoint (see `updateAgentSlug`). The slug is committed FIRST so a rejected
 * one can keep the form open with its reason — saving the other two first would
 * leave them persisted behind a form the user still has to fix.
 */
export const useAgentIdentityForm = ({ agentId, onSaved }: UseAgentIdentityFormOptions) => {
  const { t } = useTranslation('setting');

  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);

  const [name, setName] = useState(meta.name || '');
  const [title, setTitle] = useState(meta.title || '');
  const [nextSlug, setNextSlug] = useState(slug || '');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const trimmedSlug = nextSlug.trim().toLowerCase();
      if (trimmedSlug && trimmedSlug !== (slug || '')) {
        const result = await agentService.updateAgentSlug(agentId, trimmedSlug);
        if (!result.success) {
          setError(t(`settingAgent.slug.error.${result.reason ?? 'invalid'}`));
          return;
        }
        await refreshAgentConfig(agentId);
      }

      await updateMetaById(agentId, { name: name.trim(), title: title.trim() });
      onSaved();
    } catch {
      setError(t('settingAgent.identity.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return {
    error,
    name,
    save,
    saving,
    setName,
    setSlug: (value: string) => {
      setNextSlug(value);
      setError(undefined);
    },
    setTitle,
    slug: nextSlug,
    title,
  };
};
