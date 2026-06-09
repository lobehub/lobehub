'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ImperativeModalProps,
  ModalFooter,
  type ModalInstance,
} from '@lobehub/ui/base-ui';
import { t as i18nt } from 'i18next';
import { AlertCircle, LogIn } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';

interface AuthRequiredModalContentProps {
  onActionReady: (api: { signIn: () => Promise<void> }) => void;
  onClose: () => void;
  onSigningInChange?: (isSigningIn: boolean) => void;
}

const AuthRequiredModalContent = memo<AuthRequiredModalContentProps>(
  ({ onActionReady, onClose, onSigningInChange }) => {
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

    useWatchBroadcast('authorizationSuccessful', async () => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      setIsSigningIn(false);
      onClose();
      await refreshServerConfig();
    });

    useWatchBroadcast('authorizationFailed', () => {
      setIsSigningIn(false);
    });

    const signIn = useCallback(async () => {
      setIsSigningIn(true);
      clearRemoteServerSyncError();

      await connectRemoteServer({
        remoteServerUrl: dataSyncConfig?.remoteServerUrl,
        storageMode: dataSyncConfig?.storageMode || 'cloud',
      });
    }, [clearRemoteServerSyncError, connectRemoteServer, dataSyncConfig]);

    useEffect(() => {
      onActionReady({ signIn });
    }, [onActionReady, signIn]);

    return <p style={{ margin: 0 }}>{t('authModal.description')}</p>;
  },
);

AuthRequiredModalContent.displayName = 'AuthRequiredModalContent';

interface FooterProps {
  isSigningIn: boolean;
  onLater: () => void;
  onSignIn: () => void;
}

const AuthRequiredFooter = memo<FooterProps>(({ isSigningIn, onLater, onSignIn }) => {
  const { t } = useTranslation('auth');
  return (
    <ModalFooter>
      <Button disabled={isSigningIn} onClick={onLater}>
        {t('authModal.later')}
      </Button>
      <Button icon={<Icon icon={LogIn} />} loading={isSigningIn} type="primary" onClick={onSignIn}>
        {isSigningIn ? t('authModal.signingIn') : t('authModal.signIn')}
      </Button>
    </ModalFooter>
  );
});
AuthRequiredFooter.displayName = 'AuthRequiredFooter';

export const useAuthRequiredModal = () => {
  const instanceRef = useRef<ModalInstance | null>(null);

  const open = useCallback(() => {
    if (instanceRef.current) return;

    let isSigningIn = false;
    const isClosingRef = { current: false };
    let signIn: () => Promise<void> = async () => {};

    const handleClose = () => {
      if (isClosingRef.current) return;
      isClosingRef.current = true;
      instanceRef.current?.close();
      instanceRef.current = null;
    };

    const renderFooter = () => (
      <AuthRequiredFooter
        isSigningIn={isSigningIn}
        onLater={handleClose}
        onSignIn={() => signIn()}
      />
    );

    instanceRef.current = createModal({
      content: (
        <AuthRequiredModalContent
          onClose={handleClose}
          onActionReady={(api) => {
            signIn = api.signIn;
          }}
          onSigningInChange={(next) => {
            if (isSigningIn === next) return;
            isSigningIn = next;
            instanceRef.current?.update?.({
              footer: renderFooter(),
              maskClosable: !next,
            } as Partial<ImperativeModalProps>);
          }}
        />
      ),
      footer: renderFooter(),
      maskClosable: false,
      title: (
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={AlertCircle} />
          {i18nt('authModal.title', { ns: 'auth' })}
        </Flexbox>
      ),
    });
  }, []);

  return { open };
};

const AuthRequiredModal = memo(() => {
  const { open } = useAuthRequiredModal();

  useWatchBroadcast('authorizationRequired', () => {
    const state = useElectronStore.getState();
    if (state.isConnectionDrawerOpen) return;
    // Wait until remote sync config has loaded once (avoid a flash before SWR resolves).
    // Do not gate on `dataSyncConfig.active`: after sign-out `active` is false but 401 + X-Auth-Required
    // still means the user must re-authenticate; gating on active would suppress the modal forever.
    if (!state.isInitRemoteServerConfig) return;

    open();
  });

  return null;
});

AuthRequiredModal.displayName = 'AuthRequiredModal';

export default AuthRequiredModal;
