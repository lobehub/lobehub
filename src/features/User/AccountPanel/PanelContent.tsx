import { Flexbox, type MenuProps } from '@lobehub/ui';
import { type FC } from 'react';

import Menu, { type MenuProps as AntdMenuProps } from '@/components/Menu';
import { isDesktop } from '@/const/version';
import LangButton from '@/features/User/UserPanel/LangButton';
import { navigateToDesktopOnboarding } from '@/routes/(desktop)/desktop-onboarding/navigation';
import { DesktopOnboardingScreen } from '@/routes/(desktop)/desktop-onboarding/types';
import { useUserStore } from '@/store/user';

import AccountHeader from './AccountHeader';
import { useAccountMenu } from './useMenu';

interface PanelContentProps {
  closePopover: () => void;
  extraItems?: MenuProps['items'];
}

const PanelContent: FC<PanelContentProps> = ({ closePopover, extraItems }) => {
  const signOut = useUserStore((s) => s.logout);
  const { mainItems, logoutItems } = useAccountMenu();

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
    <Flexbox gap={2} style={{ minWidth: 260, width: '100%' }}>
      <AccountHeader onNavigate={closePopover} />
      {extraItems && extraItems.length > 0 && (
        <Menu items={extraItems as AntdMenuProps['items']} onClick={closePopover} />
      )}
      <Menu items={mainItems} onClick={closePopover} />
      <LangButton placement={'right' as any} />
      <Menu items={logoutItems} onClick={handleSignOut} />
    </Flexbox>
  );
};

export default PanelContent;
