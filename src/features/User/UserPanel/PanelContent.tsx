import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { useRouter } from '@/libs/next/navigation';
import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { clearDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import BusinessPanelContent from '@/business/client/features/User/BusinessPanelContent';
import BrandWatermark from '@/components/BrandWatermark';
import Menu from '@/components/Menu';
import { isDesktop } from '@/const/version';
import { enableBetterAuth, enableNextAuth } from '@/envs/auth';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import DataStatistics from '../DataStatistics';
import UserInfo from '../UserInfo';
import UserLoginOrSignup from '../UserLoginOrSignup';
import LangButton from './LangButton';
import { useMenu } from './useMenu';

const PanelContent = memo<{ closePopover: () => void }>(({ closePopover }) => {
  const router = useRouter();
  const navigate = useNavigate();
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

      // Desktop: clear OIDC tokens (electron main) + re-enter desktop onboarding at Screen5.
      try {
        const { remoteServerService } = await import('@/services/electron/remoteServer');
        await remoteServerService.clearRemoteServerConfig();
      } catch {
        // Ignore: even if IPC is unavailable, still proceed to onboarding.
      }

      clearDesktopOnboardingCompleted();
      signOut();
      navigate('/desktop-onboarding#5', { replace: true });
      return;
    }

    signOut();
    closePopover();
    // NextAuth and Better Auth handle redirect in their own signOut methods
    if (enableNextAuth || enableBetterAuth) return;
    // Clerk uses /login page
    router.push('/login');
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
      <Flexbox gap={4} horizontal justify={'space-between'} style={{ padding: '6px 8px 6px 16px' }}>
        <BrandWatermark />
        <LangButton placement={'right' as any} />
      </Flexbox>
    </Flexbox>
  );
});

export default PanelContent;
