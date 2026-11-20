import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useEffect, useRef, useState } from 'react';

import { rendererOtaService } from '@/services/electron/rendererOta';

export interface StagedCoreUpdate {
  applyMode: 'reload' | 'relaunch';
  version: string;
}

/**
 * Tracks the core (OTA) update that is downloaded and waiting to be applied.
 * The shell updater only knows about full app releases, so anything that
 * reports "up to date" from it must also consult this state.
 */
export const useStagedCoreUpdate = (enabled: boolean): StagedCoreUpdate | null => {
  const [staged, setStaged] = useState<StagedCoreUpdate | null>(null);
  // A broadcast is newer than an in-flight status read; never let the read overwrite it.
  const receivedEvent = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    rendererOtaService
      .getStatus()
      .then((status) => {
        if (!active || receivedEvent.current) return;
        setStaged(
          status.staged && status.applyMode
            ? { applyMode: status.applyMode, version: status.staged }
            : null,
        );
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [enabled]);

  useWatchBroadcast('updateReady', (info) => {
    if (info.kind !== 'core-reload' && info.kind !== 'core-relaunch') return;
    receivedEvent.current = true;
    setStaged({
      applyMode: info.kind === 'core-relaunch' ? 'relaunch' : 'reload',
      version: info.version,
    });
  });

  useWatchBroadcast('coreUpdateApplied', (version) => {
    receivedEvent.current = true;
    setStaged((current) => (current?.version === version ? null : current));
  });

  useWatchBroadcast('updateChannelChanged', () => {
    receivedEvent.current = true;
    setStaged(null);
  });

  return staged;
};
