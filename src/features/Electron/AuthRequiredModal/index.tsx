'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon } from '@lobehub/ui';
import type { ImperativeModalProps, ModalInstance } from '@lobehub/ui/base-ui';
import { Button, createModal, ModalFooter } from '@lobehub/ui/base-ui';
import debug from 'debug';
import { AlertCircle, LogIn } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';

const log = debug('lobe-client:auth-required-modal');

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
  onSignIn: () => void;
}

const AuthRequiredFooter = memo<FooterProps>(({ isSigningIn, onSignIn }) => {
  const { t } = useTranslation('auth');
  return (
    <ModalFooter>
      <Button icon={<Icon icon={LogIn} />} loading={isSigningIn} type="primary" onClick={onSignIn}>
        {isSigningIn ? t('authModal.signingIn') : t('authModal.signIn')}
      </Button>
    </ModalFooter>
  );
});
AuthRequiredFooter.displayName = 'AuthRequiredFooter';

const AuthRequiredModalTitle = memo(() => {
  const { t } = useTranslation('auth');

  return (
    <Flexbox horizontal align="center" gap={8}>
      <Icon icon={AlertCircle} />
      {t('authModal.title')}
    </Flexbox>
  );
});
AuthRequiredModalTitle.displayName = 'AuthRequiredModalTitle';

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
      <AuthRequiredFooter isSigningIn={isSigningIn} onSignIn={() => signIn()} />
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
              maskClosable: false,
            } as Partial<ImperativeModalProps>);
          }}
        />
      ),
      footer: renderFooter(),
      maskClosable: false,
      onOpenChange: (nextOpen) => {
        if (!nextOpen) {
          instanceRef.current = null;
        }
      },
      title: <AuthRequiredModalTitle />,
    });
  }, []);

  return { open };
};

const AuthRequiredModal = memo(() => {
  const { open } = useAuthRequiredModal();

  useWatchBroadcast('authorizationRequired', (payload) => {
    const reason = payload?.reason ?? 'unknown';
    const state = useElectronStore.getState();
    if (state.isConnectionDrawerOpen) {
      log('authorizationRequired ignored (connection drawer open). reason=%s', reason);
      return;
    }
    // Wait until remote sync config has loaded once (avoid a flash before SWR resolves).
    // Do not gate on `dataSyncConfig.active`: after sign-out `active` is false but 401 + X-Auth-Required
    // still means the user must re-authenticate; gating on active would suppress the modal forever.
    if (!state.isInitRemoteServerConfig) {
      log(
        'authorizationRequired ignored (remote server config not initialized). reason=%s',
        reason,
      );
      return;
    }

    log('authorizationRequired: opening modal. reason=%s', reason);
    open();
  });

  return null;
});

AuthRequiredModal.displayName = 'AuthRequiredModal';

export default AuthRequiredModal;
