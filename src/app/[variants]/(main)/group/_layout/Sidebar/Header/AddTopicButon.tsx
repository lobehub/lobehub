'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

const AddTopicButon = memo(() => {
  const { t } = useTranslation('topic');
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.SaveTopic));
  const switchToNewTopic = useAgentGroupStore((s) => s.switchToNewTopic);

  return (
    <ActionIcon
      icon={MessageSquarePlusIcon}
      onClick={switchToNewTopic}
      size={DESKTOP_HEADER_ICON_SIZE}
      title={t('actions.addNewTopic')}
      tooltipProps={{
        hotkey,
        placement: 'bottom',
      }}
    />
  );
});

export default AddTopicButon;
