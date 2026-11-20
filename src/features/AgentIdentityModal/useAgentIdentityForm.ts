import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cacheScope } from '@/libs/replica';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';

interface UseAgentIdentityFormOptions {
  agentId: string;
  onSaved: () => void;
}

const BUILTIN_SLUGS: ReadonlySet<string> = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Drives the identity fields of the agent form.
 *
 * `name`, `title` and `description` ride the ordinary meta patch; `slug` has its own validated
 * endpoint (see `updateAgentSlug`). The slug is committed FIRST so a rejected
 * one can keep the form open with its reason — saving the others first would
 * leave them persisted behind a form the user still has to fix.
 */
export const useAgentIdentityForm = ({ agentId, onSaved }: UseAgentIdentityFormOptions) => {
  const { t } = useTranslation('setting');

  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId));
  const slug = useAgentStore(agentSelectors.getAgentSlugById(agentId));
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);
  const confirmAgentSlug = useAgentStore((s) => s.internal_confirmAgentSlug);
  const updateAgentMeta = useHomeStore((s) => s.updateAgentMeta);

  const [name, setName] = useState(meta.name || '');
  const [title, setTitle] = useState(meta.title || '');
  const [description, setDescription] = useState(meta.description || '');
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
        // The rename belongs to the identity it was sent from, even if the user
        // switches workspace before it answers.
        const scope = cacheScope.get();
        const result = await agentService.updateAgentSlug(agentId, trimmedSlug);
        if (!result.success) {
          setError(t(`settingAgent.slug.error.${result.reason ?? 'invalid'}`));
          return;
        }
        // The old slug no longer names this agent; the new one does.
        confirmAgentSlug(agentId, trimmedSlug, { previousSlug: slug || undefined, scope });
        await refreshAgentConfig(agentId);
      }

      await updateAgentMeta(agentId, {
        description: description.trim(),
        name: name.trim(),
        title: title.trim(),
      });
      onSaved();
    } catch {
      setError(t('settingAgent.identity.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return {
    description,
    error,
    name,
    save,
    saving,
    setDescription,
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
