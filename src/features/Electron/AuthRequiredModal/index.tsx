'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Icon, type ModalInstance, createModal } from '@lobehub/ui';
import { AlertCircle, LogIn } from 'lucide-react';
import { type ReactNode, memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';

interface ModalUpdateOptions {
  closable?: boolean;
  keyboard?: boolean;
  maskClosable?: boolean;
  title?: ReactNode;
}

interface AuthRequiredModalContentProps {
  onClose: () => void;
  setModalProps: (props: ModalUpdateOptions) => void;
}

const AuthRequiredModalContent = memo<AuthRequiredModalContentProps>(
  ({ onClose, setModalProps }) => {
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

    // Update modal props based on signing in state
    setModalProps({
      closable: !isSigningIn,
      keyboard: !isSigningIn,
      maskClosable: !isSigningIn,
      title: (
        <Flexbox align="center" gap={8} horizontal>
          <Icon icon={AlertCircle} />
          {t('authModal.title')}
        </Flexbox>
      ),
    });

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
        <Flexbox gap={8} horizontal justify="flex-end">
          <Button disabled={isSigningIn} onClick={handleLater}>
            {t('authModal.later')}
          </Button>
          <Button
            icon={<Icon icon={LogIn} />}
            loading={isSigningIn}
            onClick={handleSignIn}
            type="primary"
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
  const instanceRef = useRef<ModalInstance | null>(null);

  const open = useCallback(() => {
    // Don't open multiple modals
    if (instanceRef.current) return;

    const setModalProps = (nextProps: ModalUpdateOptions) => {
      instanceRef.current?.update?.(nextProps);
    };

    const handleClose = () => {
      instanceRef.current?.close();
      instanceRef.current = null;
    };

    instanceRef.current = createModal({
      children: <AuthRequiredModalContent onClose={handleClose} setModalProps={setModalProps} />,
      closable: false,
      footer: null,
      keyboard: false,
      maskClosable: false,
      title: '',
    });
  }, []);

  return { open };
};

/**
 * Component that listens for authorizationRequired IPC events and opens the modal
 */
const AuthRequiredModal = memo(() => {
  const { open } = useAuthRequiredModal();

  // Listen for IPC event to open the modal
  useWatchBroadcast('authorizationRequired', () => {
    open();
  });

  return null;
});

AuthRequiredModal.displayName = 'AuthRequiredModal';

export default AuthRequiredModal;
