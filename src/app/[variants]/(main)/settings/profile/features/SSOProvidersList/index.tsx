import { isDesktop } from '@lobechat/const';
import { ActionIcon, Dropdown, Flexbox, type MenuProps, Text } from '@lobehub/ui';
import { ArrowRight, Plus, Unlink } from 'lucide-react';
import { type CSSProperties, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { modal, notification } from '@/components/AntdStaticMethods';
import AuthIcons from '@/components/NextAuth/AuthIcons';
import { userService } from '@/services/user';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const providerNameStyle: CSSProperties = {
  textTransform: 'capitalize',
};

export const SSOProvidersList = memo(() => {
  const isLoginWithBetterAuth = useUserStore(authSelectors.isLoginWithBetterAuth);
  const providers = useUserStore(authSelectors.authProviders);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const refreshAuthProviders = useUserStore((s) => s.refreshAuthProviders);
  const oAuthSSOProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  const { t } = useTranslation('auth');

  // Allow unlink if user has multiple SSO providers OR has email/password login
  const allowUnlink = providers.length > 1 || hasPasswordAccount;
  const enableBetterAuthActions = !isDesktop && isLoginWithBetterAuth;

  // Get linked provider IDs for filtering
  const linkedProviderIds = useMemo(() => {
    return new Set(providers.map((item) => item.provider));
  }, [providers]);

  // Get available providers for linking (filter out already linked)
  const availableProviders = useMemo(() => {
    return (oAuthSSOProviders || []).filter((provider) => !linkedProviderIds.has(provider));
  }, [oAuthSSOProviders, linkedProviderIds]);

  const handleUnlinkSSO = async (provider: string, providerAccountId: string) => {
    // Better-auth link/unlink operations are not available on desktop
    if (isDesktop && isLoginWithBetterAuth) return;

    // Prevent unlink if this is the only login method
    if (!allowUnlink) {
      notification.error({
        message: t('profile.sso.unlink.forbidden'),
      });
      return;
    }
    modal.confirm({
      content: t('profile.sso.unlink.description', { provider }),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        if (isLoginWithBetterAuth) {
          // Use better-auth native API
          const { unlinkAccount } = await import('@/libs/better-auth/auth-client');
          await unlinkAccount({ providerId: provider });
        } else {
          // Fallback for NextAuth
          await userService.unlinkSSOProvider(provider, providerAccountId);
        }
        refreshAuthProviders();
      },
      title: <span style={providerNameStyle}>{t('profile.sso.unlink.title', { provider })}</span>,
    });
  };

  const handleLinkSSO = async (provider: string) => {
    if (enableBetterAuthActions) {
      // Use better-auth native linkSocial API
      const { linkSocial } = await import('@/libs/better-auth/auth-client');
      await linkSocial({
        callbackURL: '/profile',
        provider: provider as any,
      });
    }
  };

  // Dropdown menu items for linking new providers
  const linkMenuItems: MenuProps['items'] = availableProviders.map((provider) => ({
    icon: AuthIcons(provider, 16),
    key: provider,
    label: <span style={providerNameStyle}>{provider}</span>,
    onClick: () => handleLinkSSO(provider),
  }));

  return (
    <Flexbox gap={8}>
      {providers.map((item) => (
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'space-between'}
          key={[item.provider, item.providerAccountId].join('-')}
        >
          <Flexbox align={'center'} gap={6} horizontal style={{ fontSize: 12 }}>
            {AuthIcons(item.provider, 16)}
            <span style={providerNameStyle}>{item.provider}</span>
            {item.email && (
              <Text fontSize={11} type="secondary">
                · {item.email}
              </Text>
            )}
          </Flexbox>
          {!(isDesktop && isLoginWithBetterAuth) && (
            <ActionIcon
              disabled={!allowUnlink}
              icon={Unlink}
              onClick={() => handleUnlinkSSO(item.provider, item.providerAccountId)}
              size={'small'}
            />
          )}
        </Flexbox>
      ))}

      {/* Link Account Button - Only show for Better-Auth users with available providers */}
      {enableBetterAuthActions && availableProviders.length > 0 && (
        <Dropdown menu={{ items: linkMenuItems, style: { maxWidth: '200px' } }} trigger={['click']}>
          <Flexbox align={'center'} gap={6} horizontal style={{ cursor: 'pointer', fontSize: 12 }}>
            <Plus size={14} />
            <span>{t('profile.sso.link.button')}</span>
            <ArrowRight size={14} />
          </Flexbox>
        </Dropdown>
      )}
    </Flexbox>
  );
});

export default SSOProvidersList;
