'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Alert, Button, Center, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { Cloud, Server, Undo2Icon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { setDesktopAutoOidcFirstOpenHandled } from '@/utils/electron/autoOidc';

import LobeMessage from '../components/LobeMessage';

// 登录方式类型
type LoginMethod = 'cloud' | 'selfhost';

// 登录状态类型
type LoginStatus = 'idle' | 'loading' | 'success' | 'error';

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
  const [selfhostLoginStatus, setSelfhostLoginStatus] = useState<LoginStatus>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showEndpoint, setShowEndpoint] = useState(false);

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

  // Ensure remote server config is loaded early (desktop only hook)
  useDataSyncConfig();

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
    await refreshServerConfig();
  });

  useWatchBroadcast('authorizationFailed', ({ error }) => {
    setRemoteError(error);
    if (cloudLoginStatus === 'loading') setCloudLoginStatus('error');
    if (selfhostLoginStatus === 'loading') setSelfhostLoginStatus('error');
  });

  // 渲染 Cloud 登录内容
  const renderCloudContent = () => {
    if (cloudLoginStatus === 'success') {
      return (
        <Button
          block
          disabled={isSigningOut || isConnectingServer}
          icon={Cloud}
          onClick={handleSignOut}
          size={'large'}
          type={'default'}
        >
          {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
        </Button>
      );
    }

    if (cloudLoginStatus === 'error') {
      return (
        <>
          <Alert
            description={remoteError || t('authResult.failed.desc')}
            style={{ width: '100%' }}
            title={t('authResult.failed.title')}
            type={'secondary'}
          />
          <Button
            block
            icon={Cloud}
            onClick={() => setCloudLoginStatus('idle')}
            size={'large'}
            type={'primary'}
          >
            {t('screen5.actions.tryAgain')}
          </Button>
        </>
      );
    }

    return (
      <Button
        block
        disabled={cloudLoginStatus === 'loading' || isConnectingServer}
        icon={Cloud}
        loading={cloudLoginStatus === 'loading'}
        onClick={handleCloudLogin}
        size={'large'}
        type={'primary'}
      >
        {cloudLoginStatus === 'loading'
          ? t('screen5.actions.signingIn')
          : t('screen5.actions.signInCloud')}
      </Button>
    );
  };

  // 渲染 Self-host 登录内容
  const renderSelfhostContent = () => {
    if (selfhostLoginStatus === 'success') {
      return (
        <Button
          block
          disabled={isSigningOut || isConnectingServer}
          icon={Server}
          onClick={handleSignOut}
          size={'large'}
          type={'default'}
        >
          {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
        </Button>
      );
    }

    if (selfhostLoginStatus === 'error') {
      return (
        <Flexbox gap={16}>
          <Alert
            description={remoteError || t('authResult.failed.desc')}
            style={{ width: '100%' }}
            title={t('authResult.failed.title')}
            type={'secondary'}
          />
          <Button icon={Server} onClick={() => setSelfhostLoginStatus('idle')} type={'primary'}>
            {t('screen5.actions.tryAgain')}
          </Button>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={16} style={{ width: '100%' }}>
        <Text color={cssVar.colorTextSecondary}>{t(loginMethodMetas.selfhost.descriptionKey)}</Text>
        <Input
          onChange={(e) => setEndpoint(e.target.value)}
          onContextMenu={async (e) => {
            if (!isDesktop) return;
            e.preventDefault();
            const { electronSystemService } = await import('@/services/electron/system');
            await electronSystemService.showContextMenu('edit');
          }}
          placeholder={t('screen5.selfhost.endpointPlaceholder')}
          prefix={<Icon icon={Server} style={{ marginRight: 4 }} />}
          size={'large'}
          style={{ width: '100%' }}
          value={endpoint}
        />
        <Button
          disabled={!endpoint.trim() || selfhostLoginStatus === 'loading' || isConnectingServer}
          loading={selfhostLoginStatus === 'loading'}
          onClick={handleSelfhostConnect}
          size={'large'}
          style={{ width: '100%' }}
          type={'primary'}
        >
          {selfhostLoginStatus === 'loading'
            ? t('screen5.actions.connecting')
            : t('screen5.actions.connectToServer')}
        </Button>
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={32}>
      <Flexbox>
        <LobeMessage sentences={[t('screen5.title'), t('screen5.title2'), t('screen5.title3')]} />
        <Text as={'p'}>{t('screen5.description')}</Text>
      </Flexbox>

      <Flexbox align={'flex-start'} gap={16} style={{ width: '100%' }} width={'100%'}>
        {renderCloudContent()}
        {!showEndpoint ? (
          <Center width={'100%'}>
            <Button
              onClick={() => setShowEndpoint(true)}
              style={{
                color: cssVar.colorTextSecondary,
              }}
              type={'text'}
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
            onClick={onBack}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
          >
            {t('back')}
          </Button>
          <Button onClick={onNext} type={'primary'}>
            {t('screen5.navigation.next')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
});

LoginStep.displayName = 'LoginStep';

export default LoginStep;
