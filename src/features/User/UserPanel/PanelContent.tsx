import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { navigateToDesktopOnboarding } from '@/app/[variants]/(desktop)/desktop-onboarding/navigation';
import { clearDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { DesktopOnboardingScreen } from '@/app/[variants]/(desktop)/desktop-onboarding/types';
import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import BrandWatermark from '@/components/BrandWatermark';
import Menu from '@/components/Menu';
import { isDesktop } from '@/const/version';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import DataStatistics from '../DataStatistics';
import UserInfo from '../UserInfo';
import UserLoginOrSignup from '../UserLoginOrSignup';
import LangButton from './LangButton';
import { useMenu } from './useMenu';

const PanelContent = memo<{ closePopover: () => void }>(({ closePopover }) => {
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
        clearDesktopOnboardingCompleted();
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
      <Menu items={logoutItems} onClick={handleSignOut} />
      <Flexbox horizontal gap={4} justify={'space-between'} style={{ padding: '6px 8px 6px 16px' }}>
        <BrandWatermark />
        <LangButton placement={'right' as any} />
      </Flexbox>
    </Flexbox>
  );
});

export default PanelContent;
