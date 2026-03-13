import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Link } from 'react-router-dom';

import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import Menu from '@/components/Menu';
import { isDesktop } from '@/const/version';
import UserInfo from '@/features/User/UserInfo';
import { navigateToDesktopOnboarding } from '@/routes/(desktop)/desktop-onboarding/navigation';
import { DesktopOnboardingScreen } from '@/routes/(desktop)/desktop-onboarding/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import DataStatistics from '../DataStatistics';
import UserLoginOrSignup from '../UserLoginOrSignup';
import LangButton from './LangButton';
import { useMenu } from './useMenu';

const PanelContent: FC<{ closePopover: () => void }> = ({ closePopover }) => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);
  const [openSignIn, signOut] = useUserStore((s) => [s.openLogin, s.logout]);
  const { mainItems, logoutItems } = useMenu();

  const handleSignIn = () => {
    openSignIn();
    closePopover();
  };

  const handleSignOut = async () => {
    if (isDesktop) {
      closePopover();

      try {
        const { remoteServerService } = await import('@/services/electron/remoteServer');
        await remoteServerService.clearRemoteServerConfig();
      } catch (error) {
        console.error(error);
      } finally {
        signOut();
        navigateToDesktopOnboarding(DesktopOnboardingScreen.Login);
      }
      return;
    }

    signOut();
    closePopover();
  };

  return (
    <Flexbox gap={2} style={{ minWidth: 300 }}>
      {isDesktop || isLoginWithAuth ? (
        <>
          <UserInfo avatarProps={{ clickable: false }} />
          <Link style={{ color: 'inherit' }} to={'/settings/stats'}>
            <DataStatistics />
          </Link>
          {ENABLE_BUSINESS_FEATURES && <BusinessPanelContent />}
        </>
      ) : (
        <UserLoginOrSignup onClick={handleSignIn} />
      )}

      <Menu items={mainItems} onClick={closePopover} />
      <LangButton placement={'right' as any} />
      <Menu items={logoutItems} onClick={handleSignOut} />
    </Flexbox>
  );
};

export default PanelContent;
