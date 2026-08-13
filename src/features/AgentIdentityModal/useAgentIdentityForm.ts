import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useAgentMeta, useAgentValue } from '@/store/agent/projection';
import { useHomeStore } from '@/store/home';

interface UseAgentIdentityFormOptions {
  agentId: string;
  onSaved: () => void;
}

const BUILTIN_SLUGS: ReadonlySet<string> = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

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

  const meta = useAgentMeta(agentId);
  const slug = useAgentValue(agentId, agentProjectionSelectors.slug);
  const updateMetaById = useAgentStore((s) => s.updateAgentMetaById);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

  const [name, setName] = useState(meta.name || '');
  const [title, setTitle] = useState(meta.title || '');
  const [nextSlug, setNextSlug] = useState(slug || '');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // A builtin agent IS its slug — `getBuiltinAgent` resolves it by that string,
  // so renaming one would mint a second, empty inbox / page agent. The server
  // refuses it too (`reason: 'builtin'`); locking the field here is what makes
  // that legible instead of a rejection after the fact.
  const slugLocked = !!slug && BUILTIN_SLUGS.has(slug);

  const save = async () => {
    setSaving(true);
    try {
      const trimmedSlug = slugLocked ? slug : nextSlug.trim().toLowerCase();
      if (trimmedSlug && trimmedSlug !== (slug || '')) {
        const result = await agentService.updateAgentSlug(agentId, trimmedSlug);
        if (!result.success) {
          setError(t(`settingAgent.slug.error.${result.reason ?? 'invalid'}`));
          return;
        }
        await refreshAgentConfig(agentId);
      }

      await updateMetaById(agentId, { name: name.trim(), title: title.trim() });
      // The sidebar holds its own copy of the label — without this the list keeps
      // showing the old name until something else revalidates. Same convention as
      // the sidebar's own rename popover.
      await refreshAgentList();
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
    slugLocked,
    title,
  };
};
