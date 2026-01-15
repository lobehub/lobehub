'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { MessageSquarePlusIcon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useActionSWR } from '@/libs/swr';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const Nav = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const params = useParams();
  const agentId = params.aid;
  const pathname = usePathname();
  const isProfileActive = pathname.includes('/profile');
  const router = useQueryRoute();
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const hideProfile = isInbox || !isAgentEditable;
  const switchTopic = useChatStore((s) => s.switchTopic);
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
    <Flexbox gap={1} paddingInline={4}>
      <NavItem
        icon={MessageSquarePlusIcon}
        loading={isValidating}
        onClick={handleNewTopic}
        title={tTopic('actions.addNewTopic')}
      />
      {!hideProfile && (
        <NavItem
          active={isProfileActive}
          icon={BotPromptIcon}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'profile'));
          }}
          title={t('tab.profile')}
        />
      )}
      <NavItem
        icon={SearchIcon}
        onClick={() => {
          toggleCommandMenu(true);
        }}
        title={t('tab.search')}
      />
    </Flexbox>
  );
});

export default Nav;
