import { isDesktop } from '@lobechat/const';
import { type DropdownItem } from '@lobehub/ui';
import { ActionIcon, confirmModal, DropdownMenu, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { ArrowRight, Plus, Unlink } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthIcons from '@/components/AuthIcons';
import {
  canUnlinkProvider,
  getProviderDisplayName,
  isBuiltinProvider,
  normalizeProviderId,
} from '@/libs/better-auth/utils/client';
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

  // An account can be unlinked only if the user can still sign in afterwards, via email/password
  // or another SSO provider. Link-only providers (e.g. X) never count as a sign-in method.
  const linkedProviders = providers.map((item) => item.provider);
  const allowUnlink = (provider: string) =>
    canUnlinkProvider({ hasPasswordAccount, linkedProviders, provider });
  const hasLockedProvider = linkedProviders.some((provider) => !allowUnlink(provider));
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

    // The control is disabled when this is the only login method. Keep the
    // guard for callers outside the rendered list and for state races.
    if (!allowUnlink(provider)) return;
    confirmModal({
      content: t('profile.sso.unlink.description', { provider: getProviderDisplayName(provider) }),
      okButtonProps: {
        danger: true,
      },
      onOk: async () => {
        const { unlinkAccount } = await import('@/libs/better-auth/auth-client');
        await unlinkAccount({ providerId: provider });
        refreshAuthProviders();
      },
      title: (
        <span style={providerNameStyle}>
          {t('profile.sso.unlink.title', { provider: getProviderDisplayName(provider) })}
        </span>
      ),
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
  const linkMenuItems: DropdownItem[] = availableProviders.map((provider) => ({
    icon: AuthIcons(provider, 16),
    key: provider,
    label: <span style={providerNameStyle}>{getProviderDisplayName(provider)}</span>,
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
            <span style={providerNameStyle}>{getProviderDisplayName(item.provider)}</span>
            {item.email && (
              <Text fontSize={11} type="secondary">
                · {item.email}
              </Text>
            )}
          </Flexbox>
          {!isDesktop && (
            <Tooltip
              title={!allowUnlink(item.provider) ? t('profile.sso.unlink.forbidden') : undefined}
            >
              <span>
                <ActionIcon
                  disabled={!allowUnlink(item.provider)}
                  icon={Unlink}
                  size={'small'}
                  onClick={() => handleUnlinkSSO(item.provider)}
                />
              </span>
            </Tooltip>
          )}
        </Flexbox>
      ))}

      {!isDesktop && hasLockedProvider && (
        <Text fontSize={11} type="secondary">
          {t('profile.sso.unlink.forbidden')}
        </Text>
      )}

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
