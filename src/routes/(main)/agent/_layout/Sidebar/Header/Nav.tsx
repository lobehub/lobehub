'use client';

import { Flexbox } from '@lobehub/ui';
import { BotPromptIcon } from '@lobehub/ui/icons';
import { RadioTowerIcon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname } from '@/libs/router/navigation';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const Nav = memo(() => {
  const { t } = useTranslation('chat');
  const params = useParams();
  const agentId = params.aid;
  const pathname = usePathname();
  const isProfileActive = pathname.includes('/profile');
  const isIntegrationActive = pathname.includes('/channel');
  const router = useQueryRoute();
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const hideProfile = !isAgentEditable;
  const switchTopic = useChatStore((s) => s.switchTopic);

  return (
    <Flexbox gap={1} paddingInline={4}>
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
      {!hideProfile && isDevMode && (
        <NavItem
          active={isIntegrationActive}
          icon={RadioTowerIcon}
          title={t('tab.integration')}
          onClick={() => {
            switchTopic(null, { skipRefreshMessage: true });
            router.push(urlJoin('/agent', agentId!, 'channel'));
          }}
        />
      )}
      <NavItem
        icon={SearchIcon}
        title={t('tab.search')}
        onClick={() => {
          toggleCommandMenu(true);
        }}
      />
    </Flexbox>
  );
});

export default Nav;
