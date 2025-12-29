import { createStaticStyles, cx } from 'antd-style';
import { Bell, Check, FolderOpen, Mic, MonitorCog } from 'lucide-react';
import { motion } from 'motion/react';
import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ensureElectronIpc } from '@/utils/electron/ipc';

import { TitleSection } from '../common/TitleSection';
import { layoutStyles } from '../styles';
import { getThemeToken } from '../styles/theme';

const themeToken = getThemeToken();

// Screen3 特有的样式
const screen3Styles = createStaticStyles(({ css, cssVar }) => ({
  // 内容区
  content: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  `,

  // 图标样式
  icon: css`
    color: var(--permission-icon-color, currentColor);
  `,

  // 图标容器
  iconWrapper: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 12px;

    background: transparent;
  `,

  // 项目描述
  itemDescription: css`
    margin: 0;
    font-size: ${cssVar.fontSize};
    line-height: 1.5;
    color: rgba(255, 255, 255, 60%);
  `,

  // 项目标题
  itemTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 500;
    color: ${themeToken.colorTextBase};
  `,

  // 按钮
  permissionButton: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: center;

    min-width: 170px;
    padding-block: 10px;
    padding-inline: 20px;
    border: 1px solid rgba(255, 255, 255, 20%);
    border-radius: 8px;

    font-size: ${cssVar.fontSize};
    font-weight: 700;
    color: ${themeToken.colorTextBase};
    white-space: nowrap;

    background: rgba(255, 255, 255, 10%);

    transition: all 0.2s ease;

    &:hover {
      border-color: rgba(255, 255, 255, 30%);
      background: rgba(255, 255, 255, 15%);
    }

    &:active {
      transform: scale(0.98);
    }

    &.granted {
      cursor: not-allowed;

      border-color: ${themeToken.colorGreen};

      /* Use currentColor so the icon and text both become "success green" */
      color: ${themeToken.colorGreen};

      opacity: 1;
      background: color-mix(in srgb, ${themeToken.colorGreen} 12%, transparent);

      &:hover {
        transform: none;
        border-color: ${themeToken.colorGreen};
        background: color-mix(in srgb, ${themeToken.colorGreen} 12%, transparent);
      }
    }
  `,

  // 列表项
  permissionItem: css`
    display: flex;
    gap: 20px;
    align-items: center;

    padding-block: 20px;
    padding-inline: 24px;
    border: 1px solid rgba(255, 255, 255, 10%);
    border-radius: ${cssVar.borderRadiusLG};

    background: rgba(255, 255, 255, 4%);
    backdrop-filter: blur(20px);

    transition:
      background-color 0.5s ease,
      border-color 0.5s ease;

    &:hover {
      border-color: rgba(255, 255, 255, 15%);
      background: rgba(255, 255, 255, 8%);
    }
  `,

  // 列表容器
  permissionList: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    width: 100%;
    max-width: 800px;

    font-family: ${cssVar.fontFamily};
  `,
}));

const permissionMetas = [
  {
    descriptionKey: 'screen3.permissions.1.description',
    icon: Bell,
    iconColor: themeToken.colorYellow,
    id: 1,
    titleKey: 'screen3.permissions.1.title',
  },
  {
    descriptionKey: 'screen3.permissions.2.description',
    icon: FolderOpen,
    iconColor: themeToken.colorGreen,
    id: 2,
    titleKey: 'screen3.permissions.2.title',
  },
  {
    descriptionKey: 'screen3.permissions.3.description',
    icon: Mic,
    iconColor: themeToken.colorBlue,
    id: 3,
    titleKey: 'screen3.permissions.3.title',
  },
  {
    descriptionKey: 'screen3.permissions.4.description',
    icon: MonitorCog,
    iconColor: themeToken.colorPurple,
    id: 4,
    titleKey: 'screen3.permissions.4.title',
  },
] as const;

type PermissionMeta = (typeof permissionMetas)[number];
type PermissionButtonKey = 'screen3.actions.grantAccess' | 'screen3.actions.openSettings';
type PermissionItem = PermissionMeta & {
  buttonKey: PermissionButtonKey;
  granted: boolean;
};

interface Screen3Props {
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

export const Screen3 = ({ onScreenConfigChange }: Screen3Props) => {
  const { t } = useTranslation('desktop-onboarding');
  // 屏幕特定的配置
  const CONFIG = {
    screenConfig: {
      navigation: {
        animate: false,
        showNextButton: true,
        showPrevButton: true,
      },
    },
  };

  const [permissions, setPermissions] = useState<PermissionItem[]>(() =>
    permissionMetas.map((p) => ({
      ...p,
      buttonKey: 'screen3.actions.grantAccess',
      granted: false,
    })),
  );

  const checkAllPermissions = useCallback(async () => {
    const ipc = ensureElectronIpc();
    if (!ipc) return;
    const state = await ipc.system.getAppState();
    const isMac = state.platform === 'darwin';
    if (!isMac) {
      // If not on macOS, assume all permissions are granted
      setPermissions((prev) => prev.map((p) => ({ ...p, granted: true })));
      return;
    }

    const notifStatus = await ipc.notification.getNotificationPermissionStatus();
    const micStatus = await ipc.system.getMediaAccessStatus('microphone');
    const screenStatus = await ipc.system.getMediaAccessStatus('screen');
    const accessibilityStatus = await ipc.system.getAccessibilityStatus();

    setPermissions((prev) =>
      prev.map((p) => {
        if (p.id === 1) return { ...p, granted: notifStatus === 'authorized' };
        // Full Disk Access cannot be checked programmatically, so it remains manual
        if (p.id === 2) return { ...p, buttonKey: 'screen3.actions.openSettings', granted: false };
        if (p.id === 3)
          return { ...p, granted: micStatus === 'granted' && screenStatus === 'granted' };
        if (p.id === 4) return { ...p, granted: accessibilityStatus };
        return p;
      }),
    );
  }, []);

  useEffect(() => {
    checkAllPermissions();
  }, [checkAllPermissions]);

  // When this page regains focus (e.g. back from System Settings), re-check permission states and refresh UI.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocus = () => {
      checkAllPermissions();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAllPermissions();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkAllPermissions]);

  const handlePermissionRequest = async (permissionId: number) => {
    const ipc = ensureElectronIpc();
    if (!ipc) return;
    switch (permissionId) {
      case 1: {
        await ipc.notification.requestNotificationPermission();
        break;
      }
      case 2: {
        await ipc.system.openFullDiskAccessSettings();
        break;
      }
      case 3: {
        await ipc.system.requestMicrophoneAccess();
        await ipc.system.requestScreenAccess();
        break;
      }
      case 4: {
        await ipc.system.requestAccessibilityAccess();
        break;
      }
      default: {
        break;
      }
    }
    // Re-check permissions after a short delay to allow system dialogs
    setTimeout(() => {
      void checkAllPermissions();
    }, 1000);
  };

  // 通知父组件屏幕配置
  useEffect(() => {
    if (onScreenConfigChange) {
      onScreenConfigChange(CONFIG.screenConfig);
    }
  }, [onScreenConfigChange]);

  return (
    <div className={layoutStyles.fullScreen}>
      {/* 内容层 */}
      <div className={layoutStyles.centered}>
        {/* 标题部分 */}
        <TitleSection
          animated={true}
          badge={t('screen3.badge')}
          description={t('screen3.description')}
          title={t('screen3.title')}
        />

        {/* 权限列表 */}
        <div className={screen3Styles.permissionList}>
          {permissions.map((permission, index) => (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className={screen3Styles.permissionItem}
              initial={{ opacity: 0, y: 50 }}
              key={permission.id}
              transition={{
                delay: 0.1 + index * 0.1,
                duration: 0.5,
                ease: [0.4, 0, 0.2, 1],
              }}
            >
              {/* 图标 */}
              <div
                className={screen3Styles.iconWrapper}
                style={{ '--permission-icon-color': permission.iconColor } as CSSProperties}
              >
                <permission.icon className={screen3Styles.icon} size={24} />
              </div>

              {/* 内容 */}
              <div className={screen3Styles.content}>
                <h3 className={screen3Styles.itemTitle}>{t(permission.titleKey)}</h3>
                <p className={screen3Styles.itemDescription}>{t(permission.descriptionKey)}</p>
              </div>

              {/* 按钮 */}
              <button
                className={cx(screen3Styles.permissionButton, permission.granted && 'granted')}
                disabled={permission.granted && permission.id !== 2}
                onClick={() => handlePermissionRequest(permission.id)}
                type="button"
              >
                {permission.granted && permission.id !== 2 ? (
                  <>
                    <Check size={16} />
                    {t('screen3.actions.granted')}
                  </>
                ) : (
                  t(permission.buttonKey)
                )}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
