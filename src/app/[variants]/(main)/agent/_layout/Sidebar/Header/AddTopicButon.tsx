'use client';

import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { HotkeyEnum } from '@/types/hotkey';

const AddTopicButon = memo(() => {
  const { t } = useTranslation('topic');
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.SaveTopic));
  const params = useParams();
  const agentId = params.aid;
  const pathname = usePathname();
  const isProfileActive = pathname.includes('/profile');
  const router = useQueryRoute();
  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);

  const { mutate, isValidating } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);
  const handleNewTopic = () => {
    // If in agent sub-route, navigate back to agent chat first
    if (isProfileActive && agentId) {
      router.push(urlJoin('/agent', agentId));
    }
    mutate();
  };

  return (
    <ActionIcon
      icon={MessageSquarePlusIcon}
      loading={isValidating}
      onClick={handleNewTopic}
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
