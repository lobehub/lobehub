'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, FormGroup, Skeleton, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useToolStore } from '@/store/tool';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import AvatarRow from './features/AvatarRow';
import FullNameRow from './features/FullNameRow';
import InterestsRow from './features/InterestsRow';
import KlavisAuthorizationList from './features/KlavisAuthorizationList';
import PasswordRow from './features/PasswordRow';
import ProfileRow, { labelStyle, rowStyle } from './features/ProfileRow';
import SSOProvidersList from './features/SSOProvidersList';
import UsernameRow from './features/UsernameRow';

const SkeletonRow = ({ mobile }: { mobile?: boolean }) => {
  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Skeleton.Button active size="small" style={{ height: 22, width: 60 }} />
          <Skeleton.Button active size="small" style={{ height: 22, width: 80 }} />
        </Flexbox>
        <Skeleton.Button active size="small" style={{ height: 22, width: 120 }} />
      </Flexbox>
    );
  }
  return (
    <Flexbox horizontal align="center" gap={24} justify="space-between" style={rowStyle}>
      <Flexbox horizontal align="center" gap={24} style={{ flex: 1 }}>
        <Skeleton.Button active size="small" style={{ ...labelStyle, height: 22 }} />
        <Skeleton.Button active size="small" style={{ height: 22, minWidth: 120, width: 160 }} />
      </Flexbox>
      <Skeleton.Button active size="small" style={{ height: 22, width: 100 }} />
    </Flexbox>
  );
};

interface ProfileSettingProps {
  mobile?: boolean;
}

const ProfileSetting = ({ mobile }: ProfileSettingProps) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const [userProfile, isUserLoaded] = useUserStore((s) => [
    userProfileSelectors.userProfile(s),
    s.isLoaded,
  ]);
  const isLoadedAuthProviders = useUserStore(authSelectors.isLoadedAuthProviders);
  const fetchAuthProviders = useUserStore((s) => s.fetchAuthProviders);
  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);
  const [servers, isServersInit, useFetchUserKlavisServers] = useToolStore((s) => [
    s.servers,
    s.isServersInit,
    s.useFetchUserKlavisServers,
  ]);
  const connectedServers = servers.filter((s) => s.status === KlavisServerStatus.CONNECTED);

  // Fetch Klavis servers
  useFetchUserKlavisServers(enableKlavis);

  const isLoading =
    !isUserLoaded || (isLogin && !isLoadedAuthProviders) || (enableKlavis && !isServersInit);

  useEffect(() => {
    if (isLogin) {
      fetchAuthProviders();
    }
  }, [isLogin, fetchAuthProviders]);

  const { t } = useTranslation('auth');

  return (
    <>
      <SettingHeader title={t('profile.title')} />
      <FormGroup collapsible={false} gap={16} title={t('profile.account')} variant={'filled'}>
        <Flexbox style={{ display: isLoading ? 'flex' : 'none' }}>
          <SkeletonRow mobile={mobile} />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow mobile={mobile} />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow mobile={mobile} />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow mobile={mobile} />
        </Flexbox>
        <Flexbox style={{ display: isLoading ? 'none' : 'flex' }}>
          {/* Avatar Row - Editable */}
          <AvatarRow mobile={mobile} />

          <Divider style={{ margin: 0 }} />

          {/* Full Name Row - Editable */}
          <FullNameRow mobile={mobile} />

          <Divider style={{ margin: 0 }} />

          {/* Username Row - Editable */}
          <UsernameRow mobile={mobile} />

          <Divider style={{ margin: 0 }} />

          {/* Interests Row - Editable */}
          <InterestsRow mobile={mobile} />

          {/* Password Row - For logged in users to change or set password */}
          {!isDesktop && isLogin && !disableEmailPassword && (
            <>
              <Divider style={{ margin: 0 }} />
              <PasswordRow mobile={mobile} />
            </>
          )}

          {/* Email Row - Read Only */}
          {isLogin && userProfile?.email && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow label={t('profile.email')} mobile={mobile}>
                <Text>{userProfile.email}</Text>
              </ProfileRow>
            </>
          )}

          {/* SSO Providers Row */}
          {isLogin && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow label={t('profile.sso.providers')} mobile={mobile}>
                <SSOProvidersList />
              </ProfileRow>
            </>
          )}

          {/* Klavis Authorizations Row */}
          {enableKlavis && connectedServers.length > 0 && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow label={t('profile.authorizations.title')} mobile={mobile}>
                <KlavisAuthorizationList servers={connectedServers} />
              </ProfileRow>
            </>
          )}
        </Flexbox>
      </FormGroup>
    </>
  );
};

export default ProfileSetting;
