'use client';

import { ActionIcon } from '@lobehub/ui';
import { SettingsIcon } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useBackButtonProps } from '@/features/NavPanel/backOrigin';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useChatStore } from '@/store/chat';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isMobileSurface } from '@/utils/mobileSurface';

import Agent from './Agent';
import Nav from './Nav';

const HeaderInfo = (_props: PropsWithChildren) => {
  const back = useBackButtonProps();
  const { t } = useTranslation('chat');
  const { aid: agentId } = useActiveRouteParams();
  const router = useQueryRoute();
  const switchTopic = useChatStore((s) => s.switchTopic);
  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource } = useResourceAccess('agent', agentId);
  const { isAgentEditable } = useServerConfigStore(featureFlagsSelectors);
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
        right={
          showProfile && !isMobileSurface() ? (
            <ActionIcon
              aria-label={t('tab.profile')}
              icon={SettingsIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              onClick={openProfile}
            />
          ) : undefined
        }
      />
      <Nav showProfile={showProfile} onOpenProfile={openProfile} />
    </>
  );
};

export default HeaderInfo;
