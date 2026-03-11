'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import {
  Bell,
  Check,
  FolderOpen,
  Mic,
  MonitorCog,
  SquareArrowOutUpRight,
  Undo2Icon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ensureElectronIpc } from '@/utils/electron/ipc';

import LobeMessage from '../components/LobeMessage';
import OnboardingFooterActions from '../components/OnboardingFooterActions';

type PermissionMeta = {
  descriptionKey: string;
  icon: typeof Bell;
  iconColor: string;
  id: number;
  titleKey: string;
};

type PermissionButtonKey = 'screen3.actions.grantAccess' | 'screen3.actions.openSettings';
type PermissionItem = PermissionMeta & {
  buttonKey: PermissionButtonKey;
  granted: boolean;
};

const permissionMetas: PermissionMeta[] = [
  {
    descriptionKey: 'screen3.permissions.1.description',
    icon: Bell,
    iconColor: '#FFCB47',
    id: 1,
    titleKey: 'screen3.permissions.1.title',
  },
  {
    descriptionKey: 'screen3.permissions.2.description',
    icon: FolderOpen,
    iconColor: '#67AF3F',
    id: 2,
    titleKey: 'screen3.permissions.2.title',
  },
  {
    descriptionKey: 'screen3.permissions.3.description',
    icon: Mic,
    iconColor: '#4A77FF',
    id: 3,
    titleKey: 'screen3.permissions.3.title',
  },
  {
    descriptionKey: 'screen3.permissions.4.description',
    icon: MonitorCog,
    iconColor: '#7A45D3',
    id: 4,
    titleKey: 'screen3.permissions.4.title',
  },
];

interface PermissionsStepProps {
  onBack: () => void;
  onNext: () => void;
}

const PermissionsStep = memo<PermissionsStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
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
    // Full Disk Access can now be checked by attempting to read protected directories
    const fullDiskStatus = await ipc.system.getFullDiskAccessStatus();

    setPermissions((prev) =>
      prev.map((p) => {
        if (p.id === 1) return { ...p, granted: notifStatus === 'authorized' };
        // Full Disk Access status is detected by reading protected directories
        if (p.id === 2)
          return { ...p, buttonKey: 'screen3.actions.openSettings', granted: fullDiskStatus };
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

  // Listen for window focus event from Electron main process
  // This is more reliable than browser focus events in Electron environment
  useWatchBroadcast('windowFocused', () => {
    checkAllPermissions();
  });

  const handlePermissionRequest = async (permissionId: number) => {
    const ipc = ensureElectronIpc();
    if (!ipc) return;
    switch (permissionId) {
      case 1: {
        await ipc.notification.requestNotificationPermission();
        break;
      }
      case 2: {
        // Use native prompt dialog for Full Disk Access
        await ipc.system.promptFullDiskAccessIfNotGranted();
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

  return (
    <Flexbox gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox>
        <LobeMessage sentences={[t('screen3.title'), t('screen3.title2'), t('screen3.title3')]} />
        <Text as={'p'}>{t('screen3.description')}</Text>
      </Flexbox>
      <Block gap={12} padding={4} style={{ width: '100%' }} variant={'outlined'}>
        {permissions.map((permission) => (
          <Block
            horizontal
            align={'center'}
            clickable={!permission.granted}
            gap={16}
            key={permission.id}
            paddingBlock={8}
            paddingInline={'12px 12px'}
            variant={'borderless'}
            style={{
              background: permission.granted ? cssVar.colorFillSecondary : undefined,
              borderColor: permission.granted ? cssVar.colorSuccess : undefined,
            }}
            onClick={() => !permission.granted && handlePermissionRequest(permission.id)}
          >
            <Block align={'center'} height={40} justify={'center'} variant={'outlined'} width={40}>
              <Icon color={cssVar.colorTextDescription} icon={permission.icon} size={20} />
            </Block>
            <Flexbox gap={2} style={{ flex: 1 }}>
              <Text weight={500}>{t(permission.titleKey as any)}</Text>
              <Text color={cssVar.colorTextSecondary} fontSize={12}>
                {t(permission.descriptionKey as any)}
              </Text>
            </Flexbox>
            {permission.granted ? (
              <Icon color={cssVar.colorSuccess} icon={Check} size={20} />
            ) : (
              <Button
                icon={SquareArrowOutUpRight}
                iconPosition={'end'}
                size={'small'}
                type={'text'}
                style={{
                  color: cssVar.colorTextSecondary,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePermissionRequest(permission.id);
                }}
              >
                {t(permission.buttonKey)}
              </Button>
            )}
          </Block>
        ))}
      </Block>
      <OnboardingFooterActions
        left={
          <Button
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={onBack}
          >
            {t('back')}
          </Button>
        }
        right={
          <Button type={'primary'} onClick={onNext}>
            {t('next')}
          </Button>
        }
      />
    </Flexbox>
  );
});

PermissionsStep.displayName = 'PermissionsStep';

export default PermissionsStep;
