import type { ProcessInfo } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useState } from 'react';

import { processManagerService } from '@/services/electron/processManagerService';

/**
 * Subscribes to the ProcessManagerCtr broadcast and keeps a live list of
 * tracked processes. Reconciles incoming events against an internal Map keyed
 * by shellId so registered / exited / killed flips are cheap.
 */
export const useProcessList = () => {
  const [items, setItems] = useState<Map<string, ProcessInfo>>(new Map());
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const res = await processManagerService.listProcesses();
    const next = new Map<string, ProcessInfo>();
    for (const p of res.processes) next.set(p.shellId, p);
    setItems(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useWatchBroadcast('processManagerChanged', ({ process }) => {
    setItems((prev) => {
      const next = new Map(prev);
      next.set(process.shellId, process);
      return next;
    });
  });

  const kill = useCallback(async (shellId: string) => {
    await processManagerService.killProcess({ shellId });
  }, []);

  return { items: [...items.values()], kill, loading, refetch };
};
