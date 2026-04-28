'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, FormGroup, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useToolStore } from '@/store/tool';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import AvatarRow from './features/AvatarRow';
import EmailRow from './features/EmailRow';
import FullNameRow from './features/FullNameRow';
import InterestsRow from './features/InterestsRow';
import KlavisAuthorizationList from './features/KlavisAuthorizationList';
import PasswordRow from './features/PasswordRow';
import ProfileRow from './features/ProfileRow';
import SSOProvidersList from './features/SSOProvidersList';
import UsernameRow from './features/UsernameRow';

const SkeletonRow = () => (
  <ProfileRow
    action={<Skeleton.Button active size="small" style={{ height: 22, width: 80 }} />}
    labelSlot={<Skeleton.Button active size="small" style={{ height: 22, width: 80 }} />}
  >
    <Skeleton.Button active size="small" style={{ height: 22, width: 160 }} />
  </ProfileRow>
);

const ProfileSetting = () => {
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
          <SkeletonRow />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow />
          <Divider style={{ margin: 0 }} />
          <SkeletonRow />
        </Flexbox>
        <Flexbox style={{ display: isLoading ? 'none' : 'flex' }}>
          <AvatarRow />

          <Divider style={{ margin: 0 }} />

          <FullNameRow />

          <Divider style={{ margin: 0 }} />

          <UsernameRow />

          <Divider style={{ margin: 0 }} />

          <InterestsRow />

          {!isDesktop && isLogin && !disableEmailPassword && (
            <>
              <Divider style={{ margin: 0 }} />
              <PasswordRow />
            </>
          )}

          {isLogin && userProfile?.email && (
            <>
              <Divider style={{ margin: 0 }} />
              <EmailRow />
            </>
          )}

          {isLogin && !isDesktop && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow label={t('profile.sso.providers')}>
                <SSOProvidersList />
              </ProfileRow>
            </>
          )}

          {enableKlavis && connectedServers.length > 0 && (
            <>
              <Divider style={{ margin: 0 }} />
              <ProfileRow label={t('profile.authorizations.title')}>
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
