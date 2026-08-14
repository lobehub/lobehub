'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { MessageSquarePlusIcon, MessagesSquareIcon, SearchIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const Nav = memo(() => {
  const { t } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const params = useActiveRouteParams();
  const agentId = params.aid;
  const { pathname } = useActiveLocation();
  // The profile entry now owns a group of sub-views — profile / channels /
  // statistics — switched by a Segmented in the page header, so all three keep
  // this entry lit instead of leaving the sidebar with nothing selected.
  const isProfileActive =
    pathname.includes('/profile') ||
    pathname.includes('/channel') ||
    pathname.endsWith('/statistics');
  const isGoalsActive = pathname.endsWith('/goals');
  // Topic IDs are prefixed `topics_`, so /agent/:aid/topics_abc would also match
  // pathname.includes('/topics') — anchor to end to avoid that false positive.
  const isTopicsActive = pathname.endsWith('/topics');
  const router = useQueryRoute();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agent', agentId);
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const hideProfile = !isAgentEditable || !isAccessResolved || !canEditContent || !canEditResource;
  const switchTopic = useChatStore((s) => s.switchTopic);
  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);
  const isNewTopicSendInFlight = useChatStore(topicSelectors.isNewTopicSendInFlight);
  const enableTopicAcceptance = useUserStore(labPreferSelectors.enableTopicAcceptance);

  const { mutate } = useActionSWR(topicActionKeys.openNewOrSave(), openNewTopicOrSaveTopic);
  const handleNewTopic = () => {
    if (!canCreateTopic || isNewTopicSendInFlight) return;
    // Always navigate to the bare agent chat URL — drops any sub-route
    // (/profile, /channel, /page, /cron/:cronId, …) and any `:topicId`
    // segment so the new topic isn't conflated with the previous URL.
    if (agentId) {
      router.push(urlJoin('/agent', agentId));
    }
    mutate();
  };

  return (
    <Flexbox gap={1} paddingInline={4}>
      <NavItem
        disabled={!canCreateTopic || isNewTopicSendInFlight}
        icon={MessageSquarePlusIcon}
        title={tTopic('actions.addNewTopic')}
        onClick={handleNewTopic}
      />
      <NavItem
        icon={SearchIcon}
        title={t('tab.search')}
        onClick={() => {
          toggleCommandMenu(true);
        }}
      />
      <NavItem
        active={isTopicsActive}
        icon={MessagesSquareIcon}
        title={tTopic('management.sidebarEntry')}
        onClick={() => {
          switchTopic(null, { skipRefreshMessage: true });
          router.push(urlJoin('/agent', agentId!, 'topics'));
        }}
      />
      {!hideProfile && (
        <NavItem
          active={isProfileActive}
          icon={BotPromptIcon}
          title={t('tab.profile')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'profile'));
          }}
        />
      )}
      {enableTopicAcceptance && (
        <NavItem
          active={isGoalsActive}
          icon={TargetIcon}
          title={t('goalList.title')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'goals'));
          }}
        />
      )}
    </Flexbox>
  );
});

export default Nav;
