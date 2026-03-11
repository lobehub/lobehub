import { Icon } from '@lobehub/ui';
import { type MenuItemType } from 'antd/es/menu/interface';
import { Bot, BrainCog, Handshake, MessagesSquare, Mic2, UserCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

interface UseCategoryOptions {
  mobile?: boolean;
}

export const useCategory = ({ mobile }: UseCategoryOptions = {}) => {
  const { t } = useTranslation('setting');
  const iconSize = mobile ? 20 : undefined;
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);

  const cateItems: MenuProps['items'] = useMemo(
    () =>
      [
        !isInbox && {
          icon: <Icon icon={UserCircle} size={iconSize} />,
          key: ChatSettingsTabs.Meta,
          label: t('agentTab.meta'),
        },
        {
          icon: <Icon icon={Bot} size={iconSize} />,
          key: ChatSettingsTabs.Prompt,
          label: t('agentTab.prompt'),
        },
        (!isInbox && {
          icon: <Icon icon={Handshake} size={iconSize} />,
          key: ChatSettingsTabs.Opening,
          label: t('agentTab.opening'),
        }) as MenuItemType,
        {
          icon: <Icon icon={MessagesSquare} size={iconSize} />,
          key: ChatSettingsTabs.Chat,
          label: t('agentTab.chat'),
        },
        {
          icon: <Icon icon={BrainCog} size={iconSize} />,
          key: ChatSettingsTabs.Modal,
          label: t('agentTab.modal'),
        },
        {
          icon: <Icon icon={Mic2} size={iconSize} />,
          key: ChatSettingsTabs.TTS,
          label: t('agentTab.tts'),
        },
      ].filter(Boolean) as MenuProps['items'],
    [t, isInbox],
  );

  return cateItems;
};
