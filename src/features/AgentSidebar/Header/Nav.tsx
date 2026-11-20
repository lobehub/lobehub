'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { DnaIcon, ListTodoIcon, MessageSquarePlusIcon, SearchIcon, TargetIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useSelfLearningSurface } from '@/features/SelfLearning/SurfaceGate/useSelfLearningSurface';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { isMobileSurface } from '@/utils/mobileSurface';

import { isAgentProfileRoute } from './isAgentProfileRoute';

interface NavProps {
  onOpenProfile: () => void;
  showProfile: boolean;
}

const Nav = ({ onOpenProfile, showProfile }: NavProps) => {
  const { t } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const { t: tSelfLearning } = useTranslation('selfLearning');
  const params = useActiveRouteParams();
  const agentId = params.aid;
  const { pathname } = useActiveLocation();
  // The profile entry owns a group of sub-views — profile / channels /
  // statistics / share. On mobile they stay switched by a Segmented while this
  // list remains in the drawer, so every one of them keeps this entry lit.
  // 下钻页 /self-evolving/:domainId 也算在这个入口下，否则点进去侧边栏就失焦了
  const isSelfLearningActive = pathname.includes('/self-evolving');
  const isProfileActive = isAgentProfileRoute(pathname) && !isSelfLearningActive;
  const isGoalsActive = pathname.endsWith('/goals');
  const isTasksActive = pathname.endsWith('/tasks') || pathname.includes('/task/');
  const router = useQueryRoute();
  const { allowed: canCreateTopic } = usePermission('create_content');
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const switchTopic = useChatStore((s) => s.switchTopic);
  const [openNewTopicOrSaveTopic] = useChatStore((s) => [s.openNewTopicOrSaveTopic]);
  const isNewTopicSendInFlight = useChatStore(topicSelectors.isNewTopicSendInFlight);
  const enableGoals = useUserStore(labPreferSelectors.enableGoals);
  const { enabled: enableSelfLearning } = useSelfLearningSurface();
  // Self-evolving lives in the profile group; it stays here only where that group
  // cannot reach it: members with no profile entry, and the mobile Segmented.
  const showSelfLearningEntry = enableSelfLearning && (!showProfile || isMobileSurface());

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
      {showProfile && isMobileSurface() && (
        <NavItem
          active={isProfileActive}
          icon={BotPromptIcon}
          title={t('tab.profile')}
          onClick={onOpenProfile}
        />
      )}
      {showSelfLearningEntry && (
        <NavItem
          active={isSelfLearningActive}
          icon={DnaIcon}
          title={tSelfLearning('title')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'self-evolving'));
          }}
        />
      )}
      {enableGoals && (
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
      <NavItem
        active={isTasksActive}
        icon={ListTodoIcon}
        title={t('tab.tasks')}
        onClick={() => {
          switchTopic(null, { skipRefreshMessage: true });
          router.push(urlJoin('/agent', agentId!, 'tasks'));
        }}
      />
    </Flexbox>
  );
};

export default Nav;
