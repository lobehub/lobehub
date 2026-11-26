'use client';

import { ActionIcon } from '@lobehub/ui';
import { SearchIcon, SettingsIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useBackButtonProps } from '@/features/NavPanel/backOrigin';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { isMacDesktop } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useHeaderActionSize } from '@/styles/density';
import { isMobileSurface } from '@/utils/mobileSurface';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = (_props: PropsWithChildren) => {
  const back = useBackButtonProps();
  const { t } = useTranslation('chat');
  const { aid: agentId } = useActiveRouteParams();
  const router = useQueryRoute();
  const switchTopic = useChatStore((s) => s.switchTopic);
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource } = useResourceAccess('agent', agentId);
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
  const headerActionSmallSize = useHeaderActionSize(true);
  // Keep the entry while resource access is loading; only a confirmed denial
  // hides it. The profile page still enforces ResourceConfigAccessGate.
  const showProfile = !!agentId && !!isAgentEditable && canEditContent && canEditResource;
  const openProfile = () => {
    if (!showProfile) return;
    switchTopic(null, { skipRefreshMessage: true });
    router.push(urlJoin('/agent', agentId!, 'profile'));
  };

  return (
    <>
      <SideBarHeaderLayout
        {...back}
        left={<Agent />}
        // Everywhere but the macOS app the header's right side holds the panel
        // toggle, so search stays a nav row there. The macOS app moves that
        // toggle into the titlebar, which leaves room for search here.
        right={
          <>
            {isMacDesktop && (
              <ActionIcon
                aria-label={t('tab.search')}
                icon={SearchIcon}
                size={headerActionSmallSize}
                title={t('tab.search')}
                onClick={() => toggleCommandMenu(true)}
              />
            )}
            {showProfile && !isMobileSurface() && (
              <ActionIcon
                aria-label={t('tab.profile')}
                icon={SettingsIcon}
                size={headerActionSmallSize}
                title={t('tab.profile')}
                onClick={openProfile}
              />
            )}
          </>
        }
      />
      <Nav showProfile={showProfile} onOpenProfile={openProfile} />
    </>
  );
};

export default HeaderInfo;
