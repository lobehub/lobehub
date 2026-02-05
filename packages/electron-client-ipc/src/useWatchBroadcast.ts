'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import type { MainBroadcastEventKey, MainBroadcastParams } from './events';

interface ElectronAPI {
  ipcRenderer: {
    on: (event: MainBroadcastEventKey, listener: (e: any, data: any) => void) => void;
    removeListener: (event: MainBroadcastEventKey, listener: (e: any, data: any) => void) => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export const useWatchBroadcast = <T extends MainBroadcastEventKey>(
  event: T,
  handler: (data: MainBroadcastParams<T>) => void,
) => {
  const handlerRef = useRef<typeof handler>(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!globalThis.electron) return;

    const listener = (_e: any, data: MainBroadcastParams<T>) => {
      handlerRef.current(data);
    };

    globalThis.electron.ipcRenderer.on(event, listener);

    return () => {
      globalThis.electron.ipcRenderer.removeListener(event, listener);
    };
  }, [event]);
};
