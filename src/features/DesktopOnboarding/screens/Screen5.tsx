import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { createStaticStyles, cx } from 'antd-style';
import { Cloud, Server } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { setDesktopAutoOidcFirstOpenHandled } from '@/utils/electron/autoOidc';

import { AuthResult } from '../common/AuthResult';
import { LogoBrand } from '../common/LogoBrand';
import { TitleSection } from '../common/TitleSection';
import { layoutStyles } from '../styles';
import { getThemeToken } from '../styles/theme';

const themeToken = getThemeToken();

// Screen4 特有的样式
const screen4Styles = createStaticStyles(({ css, cssVar }) => ({
  // 授权说明文字
  authDescription: css`
    margin: 0;
    margin-block-end: 32px;

    font-size: ${cssVar.fontSize};
    color: rgba(255, 255, 255, 60%);
    text-align: center;
  `,

  // 内容区容器
  contentContainer: css`
    display: flex;
    flex-direction: column;
    align-items: center;
  `,

  // 禁用状态按钮样式
  disabledButton: css`
    cursor: not-allowed;
    opacity: 0.5;
  `,

  // Endpoint输入框
  endpointInput: css`
    width: 100%;
    margin-block: 16px;
    margin-inline: 0;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid rgba(255, 255, 255, 10%);
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextBase};

    background: rgba(255, 255, 255, 5%);
    outline: none;

    &:focus {
      border-color: rgba(255, 255, 255, 20%);
      background: rgba(255, 255, 255, 8%);
    }
  `,

  errorText: css`
    max-width: 520px;
    margin: 0;
    margin-block-start: 16px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
    text-align: center;
    word-break: break-word;
    white-space: pre-wrap;
  `,

  // 加载状态按钮样式
  loadingButton: css`
    cursor: not-allowed;
    opacity: 0.7;
  `,

  loginContentBody: css`
    display: flex;
    flex-direction: column;
    align-items: center;

    width: 100%;
    min-width: 500px;
  `,

  loginContentHeader: css`
    display: flex;
    flex-direction: column;
    align-items: center;
  `,

  // 登录内容包装器（固定高度）
  loginContentWrapper: css`
    position: relative;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    width: 100%;
    min-height: 360px;
  `,

  // 登录方式选项卡片
  methodCard: css`
    cursor: pointer;

    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;

    min-width: 140px;
    padding-block: 10px;
    padding-inline: 20px;
    border: 1px solid rgba(255, 255, 255, 10%);
    border-radius: 8px;

    background: rgba(255, 255, 255, 2%);

    transition: all 0.3s ease;

    svg {
      color: rgba(255, 255, 255, 70%);
    }

    &:hover {
      transform: translateY(-1px);
      border-color: rgba(255, 255, 255, 20%);
      background: rgba(255, 255, 255, 5%);

      svg {
        color: rgba(255, 255, 255, 90%);
      }
    }

    &.active {
      border-color: rgba(255, 255, 255, 30%);
      background: rgba(255, 255, 255, 8%);

      svg {
        color: rgb(255, 255, 255);
      }

      span {
        color: rgb(255, 255, 255);
      }
    }
  `,

  // 方法卡片文字
  methodCardText: css`
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    color: rgba(255, 255, 255, 90%);
    white-space: nowrap;
  `,

  // 登录方式选项容器
  methodOptions: css`
    display: flex;
    gap: 12px;
    justify-content: center;
    width: 100%;
  `,

  // 登录方式选择区域
  methodSelector: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;

    width: 100%;
    margin-block-start: 48px;
  `,

  // 登录方式标题
  methodSelectorTitle: css`
    margin-block-end: 8px;
    font-size: ${cssVar.fontSize};
    color: rgba(255, 255, 255, 60%);
  `,

  // 服务名称标题
  serviceTitle: css`
    margin-block: 16px;
    margin-block-end: 8px;
    margin-inline: 0;

    font-family: ${cssVar.fontFamily};
    font-size: 32px;
    font-weight: 500;
    color: ${cssVar.colorTextBase};
  `,

  // 登录按钮
  signInButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    padding-block: 12px;
    padding-inline: 32px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    font-weight: 700;
    color: #000;

    background: ${themeToken.colorHighlight};

    &:hover {
      transform: translateY(-1px);
      background: ${themeToken.colorHighlightHover};
    }

    &:active {
      transform: translateY(0);
    }
  `,

  // 退出登录按钮（次要操作）
  signOutButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    margin-block-start: 16px;
    padding-block: 10px;
    padding-inline: 28px;
    border: 1px solid rgba(255, 255, 255, 18%);
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    font-weight: 600;
    color: rgba(255, 255, 255, 85%);

    background: rgba(255, 255, 255, 4%);

    &:hover {
      background: rgba(255, 255, 255, 8%);
    }

    &:active {
      background: rgba(255, 255, 255, 6%);
    }
  `,
}));

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

interface Screen5Props {
  onScreenConfigChange?: (config: {
    background?: {
      animate?: boolean;
      animationDelay?: number;
      animationDuration?: number;
    };
    navigation: {
      animate?: boolean;
      animationDelay?: number;
      animationDuration?: number;
      nextButtonText?: string;
      prevButtonText?: string;
      showNextButton?: boolean;
      showPrevButton?: boolean;
    };
  }) => void;
}

export const Screen5 = ({ onScreenConfigChange }: Screen5Props) => {
  const { t } = useTranslation('desktop-onboarding');
  const [currentMethod, setCurrentMethod] = useState<LoginMethod>('cloud');
  const [endpoint, setEndpoint] = useState('');
  const [cloudLoginStatus, setCloudLoginStatus] = useState<LoginStatus>('idle');
  const [selfhostLoginStatus, setSelfhostLoginStatus] = useState<LoginStatus>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

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

  // 判断是否可以开始使用
  const canStart = () => {
    switch (currentMethod) {
      case 'cloud': {
        return isCloudAuthed || cloudLoginStatus === 'success';
      }
      case 'selfhost': {
        // For self-host, require endpoint input AND verification completed for that endpoint.
        return isSelfHostEndpointVerified;
      }
      default: {
        return false;
      }
    }
  };

  // 屏幕特定的配置
  const CONFIG = {
    screenConfig: {
      navigation: {
        animate: false,
        nextButtonDisabled: !canStart(),
        nextButtonHighlight: true,
        nextButtonText: t('screen5.navigation.next'),
        showNextButton: true,
        showPrevButton: true,
      },
    },
  };

  // 通知父组件屏幕配置
  useEffect(() => {
    if (onScreenConfigChange) {
      onScreenConfigChange(CONFIG.screenConfig);
    }
  }, [onScreenConfigChange, currentMethod, cloudLoginStatus, selfhostLoginStatus, t]);

  // 处理登录方式切换
  const handleMethodChange = (method: LoginMethod) => {
    setCurrentMethod(method);
    // For self-host, prefill saved remoteServerUrl so "verified endpoint" can be determined.
    setEndpoint(method === 'selfhost' ? (dataSyncConfig?.remoteServerUrl ?? '') : '');
    // 重置登录状态
    setCloudLoginStatus('idle');
    setSelfhostLoginStatus('idle');
    setRemoteError(null);
    clearRemoteServerSyncError();
  };

  // 处理云端登录
  const handleCloudLogin = async () => {
    // Desktop runtime guard
    if (!isDesktop) {
      setRemoteError(t('screen5.errors.desktopOnlyOidc'));
      setCloudLoginStatus('error');
      return;
    }

    setRemoteError(null);
    clearRemoteServerSyncError();
    setCloudLoginStatus('loading');
    // Keep consistent with `DesktopAutoOidcOnFirstOpen`: mark as handled to prevent a second auto prompt.
    setDesktopAutoOidcFirstOpenHandled();
    await connectRemoteServer({
      remoteServerUrl: dataSyncConfig?.remoteServerUrl,
      storageMode: 'cloud',
    });
  };

  // 处理自建服务器连接
  const handleSelfhostConnect = async () => {
    // Desktop runtime guard
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

  // 返回到登录界面
  const handleReturnToLogin = () => {
    setRemoteError(null);
    clearRemoteServerSyncError();
    switch (currentMethod) {
      case 'cloud': {
        setCloudLoginStatus('idle');
        break;
      }
      case 'selfhost': {
        setSelfhostLoginStatus('idle');
        break;
      }
    }
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
    if (currentMethod !== 'selfhost') return;
    if (selfhostLoginStatus !== 'success') return;
    if (isSelfHostEndpointVerified) return;
    setSelfhostLoginStatus('idle');
  }, [currentMethod, isSelfHostEndpointVerified, selfhostLoginStatus]);

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

  // 判断是否应该显示登录结果（隐藏下拉菜单）
  const shouldShowResult = () => {
    switch (currentMethod) {
      case 'cloud': {
        return cloudLoginStatus === 'success' || cloudLoginStatus === 'error';
      } // 成功或失败都隐藏下拉菜单
      case 'selfhost': {
        return selfhostLoginStatus === 'success' || selfhostLoginStatus === 'error';
      } // 成功或失败都隐藏下拉菜单
      default: {
        return false;
      }
    }
  };

  // 渲染不同登录方式的内容
  const renderLoginContent = () => {
    const method = loginMethodMetas[currentMethod];
    const methodName = t(method.nameKey);
    const methodDescription = t(method.descriptionKey);

    switch (currentMethod) {
      case 'cloud': {
        // 如果已有登录结果，显示结果页面
        if (cloudLoginStatus === 'success') {
          return (
            <>
              <AuthResult animated={true} key="cloud-result" success={true} />
              {remoteError && <p className={screen4Styles.errorText}>{remoteError}</p>}
              <motion.button
                animate={{ opacity: 1, y: 0 }}
                className={cx(
                  screen4Styles.signOutButton,
                  (isSigningOut || isConnectingServer) && screen4Styles.loadingButton,
                )}
                disabled={isSigningOut || isConnectingServer}
                initial={{ opacity: 0, y: 30 }}
                key="cloud-signout"
                onClick={handleSignOut}
                transition={{ delay: 0.3, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
              </motion.button>
            </>
          );
        }

        // 如果登录失败，显示失败结果但允许重新登录
        if (cloudLoginStatus === 'error') {
          return (
            <>
              <AuthResult animated={true} key="cloud-error" success={false} />
              {remoteError && <p className={screen4Styles.errorText}>{remoteError}</p>}
              {/* 重新登录按钮 */}
              <motion.button
                animate={{ opacity: 1, y: 0 }}
                className={screen4Styles.signInButton}
                initial={{ opacity: 0, y: 30 }}
                key="cloud-retry"
                onClick={handleReturnToLogin}
                transition={{ delay: 0.3, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {t('screen5.actions.tryAgain')}
              </motion.button>
            </>
          );
        }

        return (
          <>
            {/* LobeHub Logo 品牌 */}
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={screen4Styles.loginContentHeader}
              initial={{ opacity: 0, y: 30 }}
              key="cloud-logo"
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <LogoBrand animated={false} logoSize={200} spacing={-20} textHeight={56} />
            </motion.div>

            {/* 授权说明 */}
            <motion.p
              animate={{ opacity: 1, y: 0 }}
              className={screen4Styles.authDescription}
              initial={{ opacity: 0, y: 30 }}
              key="cloud-desc"
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              {methodDescription}
            </motion.p>

            {/* 登录按钮 */}
            <motion.button
              animate={{ opacity: 1, y: 0 }}
              className={cx(
                screen4Styles.signInButton,
                cloudLoginStatus === 'loading' && screen4Styles.loadingButton,
              )}
              disabled={cloudLoginStatus === 'loading' || isConnectingServer}
              initial={{ opacity: 0, y: 30 }}
              key="cloud-button"
              onClick={handleCloudLogin}
              transition={{ delay: 0.5, duration: 0.5 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {cloudLoginStatus === 'loading'
                ? t('screen5.actions.signingIn')
                : t('screen5.actions.signInCloud')}
            </motion.button>
          </>
        );
      }

      case 'selfhost': {
        // 如果连接成功，显示成功结果页面
        if (selfhostLoginStatus === 'success') {
          return (
            <>
              <AuthResult animated={true} key="selfhost-result" success={true} />
              {remoteError && <p className={screen4Styles.errorText}>{remoteError}</p>}
              <motion.button
                animate={{ opacity: 1, y: 0 }}
                className={cx(
                  screen4Styles.signOutButton,
                  (isSigningOut || isConnectingServer) && screen4Styles.loadingButton,
                )}
                disabled={isSigningOut || isConnectingServer}
                initial={{ opacity: 0, y: 30 }}
                key="selfhost-signout"
                onClick={handleSignOut}
                transition={{ delay: 0.3, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isSigningOut ? t('screen5.actions.signingOut') : t('screen5.actions.signOut')}
              </motion.button>
            </>
          );
        }

        // 如果连接失败，显示失败结果但允许重新连接
        if (selfhostLoginStatus === 'error') {
          return (
            <>
              <AuthResult animated={true} key="selfhost-error" success={false} />
              {remoteError && <p className={screen4Styles.errorText}>{remoteError}</p>}
              {/* 重新连接按钮 */}
              <motion.button
                animate={{ opacity: 1, y: 0 }}
                className={screen4Styles.signInButton}
                initial={{ opacity: 0, y: 30 }}
                key="selfhost-retry"
                onClick={handleReturnToLogin}
                transition={{ delay: 0.3, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {t('screen5.actions.tryAgain')}
              </motion.button>
            </>
          );
        }

        return (
          <>
            {/* Self-host 图标和标题 */}
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={screen4Styles.loginContentHeader}
              initial={{ opacity: 0, y: 30 }}
              key="selfhost-header"
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <Server color={themeToken.colorGreen} size={80} />
              <h2 className={screen4Styles.serviceTitle}>{methodName}</h2>
              <p className={screen4Styles.authDescription}>{methodDescription}</p>
            </motion.div>

            {/* Endpoint 输入框 */}
            <div className={screen4Styles.loginContentBody}>
              <motion.input
                animate={{ opacity: 1, y: 0 }}
                className={screen4Styles.endpointInput}
                disabled={selfhostLoginStatus === 'loading'}
                initial={{ opacity: 0, y: 30 }}
                key="selfhost-input"
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={t('screen5.selfhost.endpointPlaceholder')}
                transition={{ delay: 0.5, duration: 0.5 }}
                type="text"
                value={endpoint}
              />

              <motion.button
                animate={{ opacity: 1, y: 0 }}
                className={cx(
                  screen4Styles.signInButton,
                  selfhostLoginStatus === 'loading' && screen4Styles.loadingButton,
                  !endpoint.trim() && screen4Styles.disabledButton,
                )}
                disabled={
                  !endpoint.trim() || selfhostLoginStatus === 'loading' || isConnectingServer
                }
                initial={{ opacity: 0, y: 30 }}
                key="selfhost-button"
                onClick={handleSelfhostConnect}
                transition={{ delay: 0.6, duration: 0.5 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {selfhostLoginStatus === 'loading'
                  ? t('screen5.actions.connecting')
                  : t('screen5.actions.connectToServer')}
              </motion.button>
            </div>
          </>
        );
      }

      default: {
        return null;
      }
    }
  };

  return (
    <div className={layoutStyles.fullScreen}>
      {/* 内容层 */}
      <div className={layoutStyles.centered}>
        {/* 标题部分 */}
        <TitleSection
          animated={true}
          badge={t('screen5.badge')}
          description={t('screen5.description')}
          title={t('screen5.title')}
        />

        {/* 登录区域 */}
        <div className={screen4Styles.contentContainer}>
          {/* 登录内容包装器 - 固定高度 */}
          <div className={screen4Styles.loginContentWrapper}>{renderLoginContent()}</div>

          {/* 登录方式选择 - 只在没有登录结果时显示 */}
          {!shouldShowResult() && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={screen4Styles.methodSelector}
              initial={{ opacity: 0, y: 30 }}
              transition={{ delay: 0.7, duration: 0.5 }}
            >
              <div className={screen4Styles.methodOptions}>
                {Object.values(loginMethodMetas).map((method) => (
                  <motion.div
                    className={cx(
                      screen4Styles.methodCard,
                      currentMethod === method.id && 'active',
                    )}
                    key={method.id}
                    onClick={() => handleMethodChange(method.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {method.icon && <method.icon size={20} />}
                    <span className={screen4Styles.methodCardText}>{t(method.nameKey)}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
