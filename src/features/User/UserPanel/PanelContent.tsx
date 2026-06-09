import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import UserPanelWorkspaceSection from '@/business/client/features/User/UserPanelWorkspaceSection';
import Menu from '@/components/Menu';
import { isDesktop } from '@/const/version';
import UserInfo from '@/features/User/UserInfo';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import DataStatistics from '../DataStatistics';
import UserLoginOrSignup from '../UserLoginOrSignup';
import { useMenu } from './useMenu';

const PanelContent: FC<{ closePopover: () => void }> = ({ closePopover }) => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const openSignIn = useUserStore((s) => s.openLogin);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { mainItems } = useMenu();

  const handleSignIn = () => {
    openSignIn();
    closePopover();
  };

  return (
    <Flexbox gap={2} style={{ minWidth: 300 }}>
      {isDesktop || isLoginWithAuth ? (
        <>
          <UserInfo avatarProps={{ clickable: false }} />
          <WorkspaceLink style={{ color: 'inherit' }} to={'/settings/stats'}>
            <DataStatistics />
          </WorkspaceLink>
          {enableBusinessFeatures && <BusinessPanelContent />}
          <UserPanelWorkspaceSection onSwitch={closePopover} />
        </>
      ) : (
        <UserLoginOrSignup onClick={handleSignIn} />
      )}

      <Menu items={mainItems} onClick={closePopover} />
    </Flexbox>
  );
};

export default PanelContent;
