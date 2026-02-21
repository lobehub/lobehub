'use client';

import { type AuthorizationPhase, type AuthorizationProgress } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Alert, Button, Center, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { Cloud, Server, Undo2Icon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { OFFICIAL_SITE } from '@/const/url';
import { isDesktop } from '@/const/version';
import UserInfo from '@/features/User/UserInfo';
import { remoteServerService } from '@/services/electron/remoteServer';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { setDesktopAutoOidcFirstOpenHandled } from '@/utils/electron/autoOidc';

import LobeMessage from '../components/LobeMessage';

const LEGACY_LOCAL_DB_MIGRATION_GUIDE_URL = urlJoin(
  OFFICIAL_SITE,
  '/docs/usage/migrate-from-local-database',
);

// 登录方式类型
type LoginMethod = 'cloud' | 'selfhost';

// 登录状态类型
type LoginStatus = 'idle' | 'loading' | 'success' | 'error';

const authorizationPhaseI18nKeyMap: Record<AuthorizationPhase, string> = {
  browser_opened: 'screen5.auth.phase.browserOpened',
  cancelled: 'screen5.actions.cancel',
  verifying: 'screen5.auth.phase.verifying',
  waiting_for_auth: 'screen5.auth.phase.waitingForAuth',
};

const loginMethodMetas = {
  cloud: {
    descriptionKey: 'screen5.methods.cloud.description',
    icon: Cloud,
    id: 'cloud' as LoginMethod,
    nameKey: 'screen5.methods.cloud.name',
  },
  selfhost: {
    descriptionKey: 'screen5.methods.selfhost.description',
    icon: Server,
    id: 'selfhost' as LoginMethod,
    nameKey: 'screen5.methods.selfhost.name',
  },
} as const satisfies Record<LoginMethod, unknown>;

interface LoginStepProps {
  onBack: () => void;
  onNext: () => void;
}

const LoginStep = memo<LoginStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
  const [endpoint, setEndpoint] = useState('');
  const [cloudLoginStatus, setCloudLoginStatus] = useState<LoginStatus>('idle');
  const [authProgress, setAuthProgress] = useState<AuthorizationProgress | null>(null);
  const [selfhostLoginStatus, setSelfhostLoginStatus] = useState<LoginStatus>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [hasLegacyLocalDb, setHasLegacyLocalDb] = useState(false);
  const [localRemainingSeconds, setLocalRemainingSeconds] = useState<number | null>(null);

  const [
    dataSyncConfig,
    isConnectingServer,
    remoteServerSyncError,
    useDataSyncConfig,
    connectRemoteServer,
    refreshServerConfig,
    clearRemoteServerSyncError,
    disconnectRemoteServer,
  ] = useElectronStore((s) => [
    s.dataSyncConfig,
    s.isConnectingServer,
    s.remoteServerSyncError,
    s.useDataSyncConfig,
    s.connectRemoteServer,
    s.refreshServerConfig,
    s.clearRemoteServerSyncError,
    s.disconnectRemoteServer,
  ]);

  useDataSyncConfig();

  useEffect(() => {
    if (!isDesktop) return;

    let mounted = true;
    electronSystemService
      .hasLegacyLocalDb()
      .then((value) => {
        if (mounted) setHasLegacyLocalDb(value);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const isCloudAuthed = !!dataSyncConfig?.active && dataSyncConfig.storageMode === 'cloud';
  const isSelfHostAuthed = !!dataSyncConfig?.active && dataSyncConfig.storageMode === 'selfHost';
  const isSelfHostEndpointVerified =
    isSelfHostAuthed &&
    !!endpoint.trim() &&
    endpoint.trim() === (dataSyncConfig?.remoteServerUrl ?? '');

  // 判断是否可以开始使用（任一方式成功即可）
  const canStart = () => {
    return isCloudAuthed || cloudLoginStatus === 'success' || isSelfHostEndpointVerified;
  };

  // 处理云端登录
  const handleCloudLogin = async () => {
    if (!isDesktop) {
      setRemoteError(t('screen5.errors.desktopOnlyOidc'));
      setCloudLoginStatus('error');
      return;
    }

    setRemoteError(null);
    clearRemoteServerSyncError();
    setCloudLoginStatus('loading');
    setDesktopAutoOidcFirstOpenHandled();
    await connectRemoteServer({
      remoteServerUrl: dataSyncConfig?.remoteServerUrl,
      storageMode: 'cloud',
    });
  };

  // 处理自建服务器连接
  const handleSelfhostConnect = async () => {
    if (!isDesktop) {
      setRemoteError(t('screen5.errors.desktopOnlyOidc'));
      setSelfhostLoginStatus('error');
      return;
    }

    const url = endpoint.trim();
    if (!url) return;

    setRemoteError(null);
    clearRemoteServerSyncError();
    setSelfhostLoginStatus('loading');
    await connectRemoteServer({ remoteServerUrl: url, storageMode: 'selfHost' });
  };

  // 退出登录（断开远程同步授权）并回到登录选择
  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setRemoteError(null);
    clearRemoteServerSyncError();

    try {
      await disconnectRemoteServer();
      await refreshServerConfig();
    } finally {
      setCloudLoginStatus('idle');
      setSelfhostLoginStatus('idle');
      setEndpoint('');
      setIsSigningOut(false);
    }
  };

  // Sync local UI status with real remote config
  useEffect(() => {
    if (isCloudAuthed) setCloudLoginStatus('success');
    if (isSelfHostEndpointVerified) setSelfhostLoginStatus('success');
  }, [isCloudAuthed, isSelfHostEndpointVerified]);

  // If user changes self-host endpoint after success, require re-authorization.
  useEffect(() => {
    if (selfhostLoginStatus !== 'success') return;
    if (isSelfHostEndpointVerified) return;
    setSelfhostLoginStatus('idle');
  }, [isSelfHostEndpointVerified, selfhostLoginStatus]);

  // Surface requestAuthorization errors reported via store
  useEffect(() => {
    const message = remoteServerSyncError?.message;
    if (!message) return;
    setRemoteError(message);
    if (cloudLoginStatus === 'loading') setCloudLoginStatus('error');
    if (selfhostLoginStatus === 'loading') setSelfhostLoginStatus('error');
  }, [remoteServerSyncError?.message, cloudLoginStatus, selfhostLoginStatus]);

  // Watch broadcasts from main process (polling result)
  useWatchBroadcast('authorizationSuccessful', async () => {
    setRemoteError(null);
    clearRemoteServerSyncError();
    setAuthProgress(null);
    await refreshServerConfig();
  });

  useWatchBroadcast('authorizationFailed', ({ error }) => {
    setRemoteError(error);
    setAuthProgress(null);
    if (cloudLoginStatus === 'loading') setCloudLoginStatus('error');
    if (selfhostLoginStatus === 'loading') setSelfhostLoginStatus('error');
  });

  useWatchBroadcast('authorizationProgress', (progress) => {
    setAuthProgress(progress);
    if (progress.phase === 'cancelled') {
      setCloudLoginStatus('idle');
      setSelfhostLoginStatus('idle');
      setAuthProgress(null);
    }
  });

  // Sync local countdown from authProgress
  useEffect(() => {
    if (authProgress) {
      const seconds = Math.max(
        0,
        Math.ceil((authProgress.maxPollTime - authProgress.elapsed) / 1000),
      );
      setLocalRemainingSeconds(seconds);
    } else {
      setLocalRemainingSeconds(null);
    }
  }, [authProgress]);

  // Decrement local countdown every second for smooth UI updates
  useEffect(() => {
    if (localRemainingSeconds === null || localRemainingSeconds <= 0) return;

    const timer = setTimeout(() => {
      setLocalRemainingSeconds((prev) => {
        if (prev === null || prev <= 0) return prev;
        return prev - 1;
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [localRemainingSeconds]);

  const handleCancelAuth = async () => {
    setRemoteError(null);
    clearRemoteServerSyncError();

    setCloudLoginStatus('idle');
    setSelfhostLoginStatus('idle');
    setAuthProgress(null);
    await remoteServerService.cancelAuthorization();
  };

  // 渲染 Cloud 登录内容
  const renderCloudContent = () => {
    if (cloudLoginStatus === 'success') {
      return (
        <Flexbox gap={16} style={{ width: '100%' }}>
          <Alert
            description={t('authResult.success.desc')}
            style={{ width: '100%' }}
            title={t('authResult.success.title')}
            type={'success'}
          />
          <UserInfo
            style={{
              background: cssVar.colorFillSecondary,
              borderRadius: 8,
            }}
          />
          <Button
            block
            disabled={isSigningOut || isConnectingServer}
            icon={Cloud}
            size={'large'}
            type={'default'}
            onClick={handleSignOut}
          >
            {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
          </Button>
        </Flexbox>
      );
    }

    if (cloudLoginStatus === 'error') {
      const errorMessage = remoteError?.toLowerCase().includes('timed out')
        ? t('screen5.errors.timedOut')
        : remoteError || t('authResult.failed.desc');

      return (
        <Flexbox gap={16} style={{ width: '100%' }}>
          <Alert
            description={errorMessage}
            title={t('authResult.failed.title')}
            type={'secondary'}
          />
          <Button
            block
            icon={Cloud}
            size={'large'}
            type={'primary'}
            onClick={() => setCloudLoginStatus('idle')}
          >
            {t('screen5.actions.tryAgain')}
          </Button>
        </Flexbox>
      );
    }

    if (cloudLoginStatus === 'loading') {
      const phaseText = t(authorizationPhaseI18nKeyMap[authProgress?.phase ?? 'browser_opened'], {
        defaultValue: t('screen5.actions.signingIn'),
      });

      return (
        <Flexbox gap={8} style={{ width: '100%' }}>
          <Button block disabled={true} icon={Cloud} loading={true} size={'large'} type={'primary'}>
            {t('screen5.actions.signingIn')}
          </Button>
          <Text style={{ color: cssVar.colorTextDescription }} type={'secondary'}>
            {phaseText}
          </Text>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            {localRemainingSeconds !== null ? (
              <Text style={{ color: cssVar.colorTextDescription }} type={'secondary'}>
                {t('screen5.auth.remaining', {
                  time: localRemainingSeconds,
                })}
              </Text>
            ) : (
              <div />
            )}
            <Button size={'small'} type={'text'} onClick={handleCancelAuth}>
              {t('screen5.actions.cancel')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Button
        block
        disabled={isConnectingServer}
        icon={Cloud}
        loading={false}
        size={'large'}
        type={'primary'}
        onClick={handleCloudLogin}
      >
        {t('screen5.actions.signInCloud')}
      </Button>
    );
  };

  // 渲染 Self-host 登录内容
  const renderSelfhostContent = () => {
    if (selfhostLoginStatus === 'success') {
      return (
        <Flexbox gap={16} style={{ width: '100%' }}>
          <Alert
            description={t('authResult.success.desc')}
            style={{ width: '100%' }}
            title={t('authResult.success.title')}
            type={'success'}
          />
          <UserInfo
            style={{
              background: cssVar.colorFillSecondary,
              borderRadius: 8,
            }}
          />
          <Button
            block
            disabled={isSigningOut || isConnectingServer}
            icon={Server}
            size={'large'}
            type={'default'}
            onClick={handleSignOut}
          >
            {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
          </Button>
        </Flexbox>
      );
    }

    if (selfhostLoginStatus === 'error') {
      const errorMessage = remoteError?.toLowerCase().includes('timed out')
        ? t('screen5.errors.timedOut')
        : remoteError || t('authResult.failed.desc');

      return (
        <Flexbox gap={16} style={{ width: '100%' }}>
          <Alert
            description={errorMessage}
            title={t('authResult.failed.title')}
            type={'secondary'}
          />
          <Button icon={Server} type={'primary'} onClick={() => setSelfhostLoginStatus('idle')}>
            {t('screen5.actions.tryAgain')}
          </Button>
        </Flexbox>
      );
    }

    if (selfhostLoginStatus === 'loading') {
      const phaseText = t(authorizationPhaseI18nKeyMap[authProgress?.phase ?? 'browser_opened'], {
        defaultValue: t('screen5.actions.connecting'),
      });

      return (
        <Flexbox gap={8} style={{ width: '100%' }}>
          <Button
            block
            disabled={true}
            icon={Server}
            loading={true}
            size={'large'}
            type={'primary'}
          >
            {t('screen5.actions.connecting')}
          </Button>
          <Text style={{ color: cssVar.colorTextDescription }} type={'secondary'}>
            {phaseText}
          </Text>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            {localRemainingSeconds !== null ? (
              <Text style={{ color: cssVar.colorTextDescription }} type={'secondary'}>
                {t('screen5.auth.remaining', {
                  time: localRemainingSeconds,
                })}
              </Text>
            ) : (
              <div />
            )}
            <Button size={'small'} type={'text'} onClick={handleCancelAuth}>
              {t('screen5.actions.cancel')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={16} style={{ width: '100%' }}>
        <Text color={cssVar.colorTextSecondary}>{t(loginMethodMetas.selfhost.descriptionKey)}</Text>
        <Input
          placeholder={t('screen5.selfhost.endpointPlaceholder')}
          prefix={<Icon icon={Server} style={{ marginRight: 4 }} />}
          size={'large'}
          style={{ width: '100%' }}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onContextMenu={async (e) => {
            if (!isDesktop) return;
            e.preventDefault();
            const { electronSystemService } = await import('@/services/electron/system');
            const input = e.target as HTMLInputElement;
            const selectionText = input.value.slice(
              input.selectionStart || 0,
              input.selectionEnd || 0,
            );
            await electronSystemService.showContextMenu('editor', {
              selectionText: selectionText || undefined,
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSelfhostConnect();
            }
          }}
        />
        <Button
          disabled={!endpoint.trim() || isConnectingServer}
          loading={false}
          size={'large'}
          style={{ width: '100%' }}
          type={'primary'}
          onClick={handleSelfhostConnect}
        >
          {t('screen5.actions.connectToServer')}
        </Button>
      </Flexbox>
    );
  };

  return (
    <Center gap={32} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox align={'flex-start'} justify={'flex-start'} style={{ width: '100%' }}>
        <LobeMessage sentences={[t('screen5.title'), t('screen5.title2'), t('screen5.title3')]} />
        <Text as={'p'}>{t('screen5.description')}</Text>
      </Flexbox>

      <Flexbox align={'flex-start'} gap={16} style={{ width: '100%' }} width={'100%'}>
        {renderCloudContent()}
        <Flexbox horizontal justify={'center'} style={{ width: '100%' }}>
          {hasLegacyLocalDb && (
            <Button
              style={{ padding: 0 }}
              type={'link'}
              onClick={() =>
                electronSystemService.openExternalLink(LEGACY_LOCAL_DB_MIGRATION_GUIDE_URL)
              }
            >
              {t('screen5.legacyLocalDb.link', 'Migrate legacy local database')}
            </Button>
          )}
        </Flexbox>
        {!showEndpoint ? (
          <Center width={'100%'}>
            <Button
              type={'text'}
              style={{
                color: cssVar.colorTextSecondary,
              }}
              onClick={() => setShowEndpoint(true)}
            >
              {t(loginMethodMetas.selfhost.descriptionKey)}
            </Button>
          </Center>
        ) : (
          <>
            <Divider>
              <Text fontSize={12} type={'secondary'}>
                OR
              </Text>
            </Divider>

            {/* Self-host 选项 */}
            {renderSelfhostContent()}
          </>
        )}
      </Flexbox>
      {canStart() && (
        <Flexbox horizontal justify={'space-between'} style={{ marginTop: 32 }}>
          <Button
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={onBack}
          >
            {t('back')}
          </Button>
          <Button type={'primary'} onClick={onNext}>
            {t('screen5.navigation.next')}
          </Button>
        </Flexbox>
      )}
    </Center>
  );
});

LoginStep.displayName = 'LoginStep';

export default LoginStep;
