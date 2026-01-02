'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { SearchIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const Nav = memo(() => {
  const { t } = useTranslation('chat');
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

  return (
    <Flexbox gap={1} paddingInline={4}>
      {!hideProfile && (
        <NavItem
          active={isProfileActive}
          icon={BotPromptIcon}
          onClick={() => {
            switchTopic(undefined, true);
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
