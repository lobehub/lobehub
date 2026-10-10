'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Button, createModal, Flexbox } from '@lobehub/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useMacWindowFullscreen } from '@/features/Electron/system/useMacWindowFullscreen';
import { rendererOtaService } from '@/services/electron/rendererOta';
import { useElectronStore } from '@/store/electron';

/**
 * Hydrate the electron app state (default shell, user paths, locale) into the
 * electron store and the global agent context at boot, then keep it fresh via
 * the main process's `appStateUpdated` broadcast (e.g. when the user switches
 * the Windows shell in settings).
 *
 * Mounted from `StoreInitialization` on purpose: the previous init call lived
 * in `TitleBar` and was silently dropped in a titlebar refactor (#13059),
 * leaving `{{defaultShell}}` / path placeholders unresolved for months — keep
 * this with the other store initializers so layout changes can't detach it.
 */
const ElectronAppStateSync = () => {
  useMacWindowFullscreen();
  const { t: tElectron } = useTranslation('electron');
  const { t } = useTranslation('common');
  const dismissConfirmation = useRef<(() => void) | null>(null);
  useWatchBroadcast('reloadConfirmationRequested', () => {
    dismissConfirmation.current?.();
    let resolved = false;
    const resolve = (proceed: boolean) => {
      if (resolved) return;
      resolved = true;
      return rendererOtaService.resolveUnloadConfirmation(proceed).catch(console.error);
    };
    const modal = createModal({
      title: tElectron('updater.confirmReloadTitle'),
      content: tElectron('updater.confirmReloadDescription'),
      footer: (
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button
            onClick={() => {
              void resolve(false);
              modal.close();
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            type={'primary'}
            onClick={() => {
              void resolve(true);
              modal.close();
            }}
          >
            {tElectron('updater.confirmReloadContinue')}
          </Button>
        </Flexbox>
      ),
      onOpenChange: (open) => {
        if (!open) void resolve(false);
      },
    });
    dismissConfirmation.current = () => {
      resolved = true;
      modal.close();
    };
  });

  useWatchBroadcast('reloadConfirmationCancelled', () => {
    dismissConfirmation.current?.();
    dismissConfirmation.current = null;
  });
  useEffect(
    () => () => {
      dismissConfirmation.current?.();
    },
    [],
  );

  const [useInitElectronAppState, updateElectronAppState] = useElectronStore((s) => [
    s.useInitElectronAppState,
    s.updateElectronAppState,
  ]);

  useInitElectronAppState();

  useEffect(() => {
    // Renderer OTA boot check: main rolls back the hot-updated bundle if this
    // ping never arrives after a swap.
    rendererOtaService.bootPing('mounted').catch(() => {});
  }, []);

  useWatchBroadcast('appStateUpdated', (state) => {
    updateElectronAppState(state);
  });

  return null;
};

export default ElectronAppStateSync;
