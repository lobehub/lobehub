import { Icon } from '@lobehub/ui';
import { Building2, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type MenuProps } from '@/components/Menu';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

/**
 * Aico billing / org surfaces in the user avatar menu.
 * Personal-only routes (`/wallet`, `/org`) — never workspace-prefixed.
 * Platform admin is a separate control-plane app (`@aico/control-plane`).
 */
export default function useBusinessMenuItems(isSignin: boolean | undefined): MenuProps['items'] {
  const { t } = useTranslation('aico');

  if (!isSignin) return [];

  return [
    { type: 'divider' },
    {
      icon: <Icon icon={Wallet} />,
      key: 'aico-wallet',
      label: (
        <WorkspaceLink escape to="/wallet">
          {t('nav.wallet')}
        </WorkspaceLink>
      ),
    },
    {
      icon: <Icon icon={Building2} />,
      key: 'aico-org',
      label: (
        <WorkspaceLink escape to="/org">
          {t('nav.org')}
        </WorkspaceLink>
      ),
    },
  ];
}
