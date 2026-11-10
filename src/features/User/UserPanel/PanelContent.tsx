import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';

import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import UserPanelAccountSection from '@/business/client/features/User/UserPanelAccountSection';
import UserPanelStatistics from '@/business/client/features/User/UserPanelStatistics';
import UserPanelWorkspaceSection from '@/business/client/features/User/UserPanelWorkspaceSection';
import Menu, { type MenuProps } from '@/components/Menu';
import { isDesktop } from '@/const/version';
import UserInfo from '@/features/User/UserInfo';
import { useSignOut } from '@/hooks/useSignOut';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import UserLoginOrSignup from '../UserLoginOrSignup';
import { useMenu } from './useMenu';

const PanelContent: FC<{ closePopover: () => void }> = ({ closePopover }) => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const openSignIn = useUserStore((s) => s.openLogin);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { mainItems, logoutItems } = useMenu();
  const signOut = useSignOut();

  const handleSignIn = () => {
    openSignIn();
    closePopover();
  };

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    closePopover();

    if (key === 'logout') void signOut();
  };

  return (
    // lobe-ui List rows carry no outer padding, so the panel keeps a 4px bottom
    // inset (matching the rows' 4px side inset) or the last row sits on the edge.
    <Flexbox gap={2} paddingBlock={'0 4px'} style={{ minWidth: 300 }}>
      {isDesktop || isLoginWithAuth ? (
        <>
          {/* The section below opens with gap + divider margin (6px), so a 6px bottom
              padding keeps the header's space below the avatar equal to the 12px above. */}
          <UserInfo avatarProps={{ clickable: false }} paddingBlock={'12px 6px'} />
          <UserPanelStatistics />
          {enableBusinessFeatures && <BusinessPanelContent />}
          <UserPanelWorkspaceSection onSwitch={closePopover} />
        </>
      ) : (
        <UserLoginOrSignup onClick={handleSignIn} />
      )}

      <Menu items={[...(mainItems ?? []), ...(logoutItems ?? [])]} onClick={handleMenuClick} />

      <UserPanelAccountSection onNavigate={closePopover} />
    </Flexbox>
  );
};

export default PanelContent;
