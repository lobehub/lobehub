import { randomAgentName } from '@lobechat/const';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cacheScope } from '@/libs/replica';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

/** Uploaded avatars go through a server action, which caps the body at 1MB. */
export const MAX_AVATAR_SIZE = 1024 * 1024;

export interface UseCreateAgentIdentityFormOptions {
  groupId?: string;
  onCreated: (agentId: string) => void;
  visibility?: 'private' | 'public';
}

const drawInitialName = () => {
  const locale = globalGeneralSelectors.currentLanguage(useGlobalStore.getState());
  const takenNames = homeAgentListSelectors
    .allAgents(useHomeStore.getState())
    .map((agent) => agent.name)
    .filter((name): name is string => !!name);

  return randomAgentName(locale, takenNames);
};

/**
 * Drives the create-agent form: avatar plus the same identity fields the edit
 * form has.
 *
 * The slug is optional — left empty, the server generates one. A custom slug
 * can only be validated against an existing agent (`updateAgentSlug`), so it is
 * applied right after the create. When it is rejected the form stays open with
 * the reason, and the next submit updates the agent already created instead of
 * creating a second one.
 */
export const useCreateAgentIdentityForm = ({
  groupId,
  onCreated,
  visibility,
}: UseCreateAgentIdentityFormOptions) => {
  const { t } = useTranslation('setting');

  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentConfig = useAgentStore((s) => s.internal_refreshAgentConfig);
  const confirmAgentSlug = useAgentStore((s) => s.internal_confirmAgentSlug);
  const updateAgentMeta = useHomeStore((s) => s.updateAgentMeta);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);

  const [avatar, setAvatar] = useState<string | undefined>();
  const [name, setName] = useState(drawInitialName);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [createdAgentId, setCreatedAgentId] = useState<string>();
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const uploadAvatar = async (file: File): Promise<'tooLarge' | void> => {
    if (file.size > MAX_AVATAR_SIZE) return 'tooLarge';

    setUploading(true);
    try {
      const result = await uploadWithProgress({ file });
      if (result?.url) setAvatar(result.url);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (saving || uploading) return;
    setSaving(true);
    try {
      const meta = {
        avatar: avatar ?? null,
        description: description.trim(),
        name: name.trim(),
        title: title.trim(),
      };

      let agentId = createdAgentId;
      if (agentId) {
        await updateAgentMeta(agentId, meta);
      } else {
        ({ agentId } = await createAgent({ config: meta, groupId, visibility }));
        setCreatedAgentId(agentId);
      }

      const nextSlug = slug.trim().toLowerCase();
      if (nextSlug) {
        const scope = cacheScope.get();
        const result = await agentService.updateAgentSlug(agentId, nextSlug);
        if (!result.success) {
          setError(t(`settingAgent.slug.error.${result.reason ?? 'invalid'}`));
          // The agent exists already; keep the sidebar honest while the user fixes the slug.
          void refreshAgentList();
          return;
        }
        confirmAgentSlug(agentId, nextSlug, { scope });
        await refreshAgentConfig(agentId);
      }

      await refreshAgentList();
      onCreated(agentId);
    } catch {
      setError(t('settingAgent.identity.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  return {
    avatar,
    description,
    error,
    name,
    saving,
    setAvatar,
    setDescription,
    setName,
    setSlug: (value: string) => {
      setSlug(value);
      setError(undefined);
    },
    setTitle,
    slug,
    slugLocked: false,
    submit,
    title,
    uploadAvatar,
    uploading,
  };
};
