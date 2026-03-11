import { isDesktop } from '@lobechat/const';
import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import { ArrowRight, Plus, Unlink } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { modal, notification } from '@/components/AntdStaticMethods';
import AuthIcons from '@/components/AuthIcons';
import { isBuiltinProvider, normalizeProviderId } from '@/libs/better-auth/utils/client';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const providerNameStyle: CSSProperties = {
  textTransform: 'capitalize',
};

export const SSOProvidersList = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const providers = useUserStore(authSelectors.authProviders);
  const hasPasswordAccount = useUserStore(authSelectors.hasPasswordAccount);
  const refreshAuthProviders = useUserStore((s) => s.refreshAuthProviders);
  const oAuthSSOProviders = useServerConfigStore(serverConfigSelectors.oAuthSSOProviders);
  const { t } = useTranslation('auth');

  // Allow unlink if user has multiple SSO providers OR has email/password login
  const allowUnlink = providers.length > 1 || hasPasswordAccount;
  const enableAuthActions = !isDesktop && isLogin;

  // Get linked provider IDs for filtering
  const linkedProviderIds = useMemo(() => {
    return new Set(providers.map((item) => item.provider));
  }, [providers]);

  // Get available providers for linking (filter out already linked)
  // Normalize provider IDs when comparing to handle aliases (e.g. microsoft-entra-id → microsoft)
  const availableProviders = useMemo(() => {
    return (oAuthSSOProviders || []).filter(
      (provider) => !linkedProviderIds.has(normalizeProviderId(provider)),
    );
  }, [oAuthSSOProviders, linkedProviderIds]);

  const handleUnlinkSSO = async (provider: string) => {
    // Better-auth link/unlink operations are not available on desktop
    if (isDesktop) return;

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
        const { unlinkAccount } = await import('@/libs/better-auth/auth-client');
        await unlinkAccount({ providerId: provider });
        refreshAuthProviders();
      },
      title: <span style={providerNameStyle}>{t('profile.sso.unlink.title', { provider })}</span>,
    });
  };

  const handleLinkSSO = async (provider: string) => {
    if (!enableAuthActions) return;

    const normalizedProvider = normalizeProviderId(provider);
    const { linkSocial, oauth2 } = await import('@/libs/better-auth/auth-client');

    if (isBuiltinProvider(normalizedProvider)) {
      // Use better-auth native linkSocial API for built-in providers
      await linkSocial({
        callbackURL: '/profile',
        provider: normalizedProvider as any,
      });
      return;
    }

    await oauth2.link({
      callbackURL: '/profile',
      providerId: normalizedProvider,
    });
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
          horizontal
          align={'center'}
          gap={8}
          justify={'space-between'}
          key={[item.provider, item.providerAccountId].join('-')}
        >
          <Flexbox horizontal align={'center'} gap={6} style={{ fontSize: 12 }}>
            {AuthIcons(item.provider, 16)}
            <span style={providerNameStyle}>{item.provider}</span>
            {item.email && (
              <Text fontSize={11} type="secondary">
                · {item.email}
              </Text>
            )}
          </Flexbox>
          {!isDesktop && (
            <ActionIcon
              disabled={!allowUnlink}
              icon={Unlink}
              size={'small'}
              onClick={() => handleUnlinkSSO(item.provider)}
            />
          )}
        </Flexbox>
      ))}

      {/* Link Account Button - Only show for logged in users with available providers */}
      {enableAuthActions && availableProviders.length > 0 && (
        <DropdownMenu items={linkMenuItems} popupProps={{ style: { maxWidth: '200px' } }}>
          <Flexbox horizontal align={'center'} gap={6} style={{ cursor: 'pointer', fontSize: 12 }}>
            <Plus size={14} />
            <span>{t('profile.sso.link.button')}</span>
            <ArrowRight size={14} />
          </Flexbox>
        </DropdownMenu>
      )}
    </Flexbox>
  );
});

export default SSOProvidersList;
