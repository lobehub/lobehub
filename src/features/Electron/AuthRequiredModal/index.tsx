'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type ModalInstance } from '@lobehub/ui';
import { Button, createModal, Flexbox, Icon } from '@lobehub/ui';
import { AlertCircle, LogIn } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDesktopOnboardingCompleted } from '@/app/[variants]/(desktop)/desktop-onboarding/storage';
import { useElectronStore } from '@/store/electron';

interface AuthRequiredModalContentProps {
  onClose: () => void;
  onSigningInChange?: (isSigningIn: boolean) => void;
}

const AuthRequiredModalContent = memo<AuthRequiredModalContentProps>(
  ({ onClose, onSigningInChange }) => {
    const { t } = useTranslation('auth');
    const [isSigningIn, setIsSigningIn] = useState(false);
    const isClosingRef = useRef(false);

    const [dataSyncConfig, connectRemoteServer, refreshServerConfig, clearRemoteServerSyncError] =
      useElectronStore((s) => [
        s.dataSyncConfig,
        s.connectRemoteServer,
        s.refreshServerConfig,
        s.clearRemoteServerSyncError,
      ]);

    useEffect(() => {
      onSigningInChange?.(isSigningIn);
    }, [isSigningIn, onSigningInChange]);

    // Listen for successful authorization to close the modal
    useWatchBroadcast('authorizationSuccessful', async () => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      setIsSigningIn(false);
      onClose();
      await refreshServerConfig();
    });

    // Listen for authorization failure
    useWatchBroadcast('authorizationFailed', () => {
      setIsSigningIn(false);
    });

    const handleSignIn = useCallback(async () => {
      setIsSigningIn(true);
      clearRemoteServerSyncError();

      await connectRemoteServer({
        remoteServerUrl: dataSyncConfig?.remoteServerUrl,
        storageMode: dataSyncConfig?.storageMode || 'cloud',
      });
    }, [clearRemoteServerSyncError, connectRemoteServer, dataSyncConfig]);

    const handleLater = useCallback(() => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      onClose();
    }, [onClose]);

    return (
      <Flexbox gap={16} style={{ padding: 16 }}>
        <p style={{ margin: 0 }}>{t('authModal.description')}</p>
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={isSigningIn} onClick={handleLater}>
            {t('authModal.later')}
          </Button>
          <Button
            icon={<Icon icon={LogIn} />}
            loading={isSigningIn}
            type="primary"
            onClick={handleSignIn}
          >
            {isSigningIn ? t('authModal.signingIn') : t('authModal.signIn')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

AuthRequiredModalContent.displayName = 'AuthRequiredModalContent';

/**
 * Hook to create and manage the auth required modal
 */
export const useAuthRequiredModal = () => {
  const { t } = useTranslation('auth');
  const instanceRef = useRef<ModalInstance | null>(null);

  const open = useCallback(() => {
    if (instanceRef.current) return;

    const handleClose = () => {
      instanceRef.current?.close();
      instanceRef.current = null;
    };

    const handleSigningInChange = (isSigningIn: boolean) => {
      instanceRef.current?.update?.({
        closable: !isSigningIn,
        keyboard: !isSigningIn,
        maskClosable: !isSigningIn,
      });
    };

    instanceRef.current = createModal({
      children: (
        <AuthRequiredModalContent onClose={handleClose} onSigningInChange={handleSigningInChange} />
      ),
      closable: false,
      footer: null,
      keyboard: false,
      maskClosable: false,
      title: (
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={AlertCircle} />
          {t('authModal.title')}
        </Flexbox>
      ),
    });
  }, [t]);

  return { open };
};

/**
 * Component that listens for authorizationRequired IPC events and opens the modal
 */
const AuthRequiredModal = memo(() => {
  const { open } = useAuthRequiredModal();

  useWatchBroadcast('authorizationRequired', () => {
    if (useElectronStore.getState().isConnectionDrawerOpen) return;
    if (!getDesktopOnboardingCompleted()) return;

    open();
  });

  return null;
});

AuthRequiredModal.displayName = 'AuthRequiredModal';

export default AuthRequiredModal;
