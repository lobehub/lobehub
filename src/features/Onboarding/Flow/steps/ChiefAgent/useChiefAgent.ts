import { INBOX_SESSION_ID } from '@lobechat/const';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { CHIEF_AGENT_AVATAR_PRESETS } from './avatars';
import { slugifyAgentName } from './slugify';

interface UseChiefAgentOptions {
  next: () => Promise<void>;
}

export const useChiefAgent = ({ next }: UseChiefAgentOptions) => {
  const { t } = useTranslation('onboarding');
  const defaultName = t('flow.steps.chiefAgent.defaultName');

  const useInitBuiltinAgent = useAgentStore((s) => s.useInitBuiltinAgent);
  useInitBuiltinAgent(INBOX_SESSION_ID);

  const meta = useAgentStore(agentSelectors.getAgentMetaById(INBOX_SESSION_ID));

  const [name, setName] = useState(() => meta.title || defaultName);
  const [avatar, setAvatar] = useState(() => meta.avatar || CHIEF_AGENT_AVATAR_PRESETS[0]);
  const [seeded, setSeeded] = useState(() => !!meta.title || !!meta.avatar);
  const [hiring, setHiring] = useState(false);

  useEffect(() => {
    if (seeded) return;
    if (!meta.title && !meta.avatar) return;

    setName(meta.title || defaultName);
    setAvatar(meta.avatar || CHIEF_AGENT_AVATAR_PRESETS[0]);
    setSeeded(true);
  }, [seeded, meta.title, meta.avatar, defaultName]);

  const handle = `${slugifyAgentName(name || defaultName)}@lobe.id`;

  const hire = useCallback(async () => {
    const title = name.trim() || defaultName;

    setHiring(true);
    try {
      await useAgentStore.getState().optimisticUpdateAgentMeta(INBOX_SESSION_ID, { avatar, title });
      await next();
    } finally {
      setHiring(false);
    }
  }, [avatar, name, defaultName, next]);

  return { avatar, defaultName, handle, hire, hiring, name, setAvatar, setName };
};
