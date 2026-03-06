'use client';

import { DESKTOP_HEADER_ICON_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useActionSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = memo<PropsWithChildren>(() => {
  const { t } = useTranslation('topic');
  const params = useParams();
  const agentId = params.aid;
  const pathname = usePathname();
  const isProfileActive = pathname.includes('/profile');
  const router = useQueryRoute();

  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);
  const { mutate } = useActionSWR('openNewTopicOrSaveTopic', openNewTopicOrSaveTopic);

  const handleNewTopic = () => {
    if (isProfileActive && agentId) {
      router.push(urlJoin('/agent', agentId));
    }
    mutate();
  };

  return (
    <>
      <SideBarHeaderLayout
        left={<Agent />}
        right={
          <ActionIcon
            icon={MessageSquarePlusIcon}
            size={DESKTOP_HEADER_ICON_SIZE}
            title={t('actions.addNewTopic')}
            onClick={handleNewTopic}
          />
        }
      />
      <Nav />
    </>
  );
});

export default HeaderInfo;
