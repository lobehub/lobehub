import {
  DEVICE_CLI_BATCH_MAX_TARGETS,
  type DeviceCliBatchEntry,
  type DeviceCliUpdateStateResult,
  type DeviceVisibility,
} from '@lobechat/types';
import { useEffect, useRef, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

import { refreshDeviceList } from '../const';
import {
  type BatchRowView,
  deriveBatchRowView,
  isSettledRowView,
  summarizeBatch,
} from './deriveBatchRowView';

/** The wait a single-device update gives a restart to come back. */
const FOLLOW_TIMEOUT_MS = 5 * 60_000;
const FOLLOW_INTERVAL_MS = 3000;

type FollowResults = Record<string, DeviceCliUpdateStateResult>;

export interface BatchRow {
  entry: DeviceCliBatchEntry;
  /** The device's latest state while this batch follows its update. */
  follow?: DeviceCliUpdateStateResult;
  view: BatchRowView;
}

/**
 * The batch CLI update for one visibility tab, as one state machine: check
 * every device (`checking`), show the plan (`review`), send the restarts
 * (`updating`), then follow each requested device until it reconnects on the
 * new version (`following` → `done`).
 */
export const useCliBatchUpdate = (visibility: DeviceVisibility) => {
  const workspaceId = useActiveWorkspaceId();
  // A fresh run id per check: reopening or checking again never shows a stale plan.
  const [runId, setRunId] = useState(() => crypto.randomUUID());
  const [batch, setBatch] = useState<{ entries: DeviceCliBatchEntry[]; id: string }>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string>();
  const [timedOut, setTimedOut] = useState(false);
  const lock = useRef(false);
  const lastFollow = useRef<FollowResults>({});

  const plan = useClientDataSWR(
    deviceKeys.cliBatchPlan(workspaceId, visibility, runId),
    () => deviceService.checkCliUpdates({ visibility }),
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  );

  const requested = batch?.entries.filter((entry) => entry.outcome === 'requested') ?? [];
  const isSettled = (entry: DeviceCliBatchEntry, result?: DeviceCliUpdateStateResult) =>
    isSettledRowView(deriveBatchRowView(entry, result, timedOut));

  const follow = useClientDataSWR(
    batch && requested.length > 0 ? deviceKeys.cliBatchFollow(workspaceId, batch.id) : null,
    async (): Promise<FollowResults> => {
      const previous = lastFollow.current;
      const pairs = await Promise.all(
        requested.map(async (entry) => {
          const known = previous[entry.deviceId];
          // A settled device has nothing more to report; stop asking it.
          if (known && isSettled(entry, known)) return [entry.deviceId, known] as const;
          try {
            const result = await deviceService.getCliUpdateState({ deviceId: entry.deviceId });
            return [entry.deviceId, result] as const;
          } catch (error) {
            const result: DeviceCliUpdateStateResult = {
              message: (error as Error).message,
              status: 'unavailable',
            };
            return [entry.deviceId, result] as const;
          }
        }),
      );
      lastFollow.current = Object.fromEntries(pairs);
      return lastFollow.current;
    },
    {
      refreshInterval: (results?: FollowResults) =>
        requested.every((entry) => isSettled(entry, results?.[entry.deviceId]))
          ? 0
          : FOLLOW_INTERVAL_MS,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  useEffect(() => {
    if (!batch) return;
    const timer = setTimeout(() => setTimedOut(true), FOLLOW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [batch?.id]);

  const sent = new Map(batch?.entries.map((entry) => [entry.deviceId, entry]));
  const rows: BatchRow[] = (plan.data ?? []).map((planned) => {
    const entry = sent.get(planned.deviceId) ?? planned;
    const result = follow.data?.[entry.deviceId];
    return { entry, follow: result, view: deriveBatchRowView(entry, result, timedOut) };
  });
  const summary = summarizeBatch(rows.map((row) => row.view));

  const phase = batch
    ? summary.pending > 0
      ? 'following'
      : 'done'
    : sending
      ? 'updating'
      : plan.isLoading
        ? 'checking'
        : 'review';

  // Cards on the device list show the version the CLI reported on connect.
  useEffect(() => {
    if (phase === 'done' && summary.updated > 0) void refreshDeviceList();
  }, [phase, summary.updated]);

  const update = async () => {
    const ready = rows.filter((row) => row.view === 'ready');
    if (lock.current || batch || ready.length === 0) return;
    lock.current = true;
    setSending(true);
    setSendError(undefined);
    const targets = ready.map(({ entry }) => ({
      deviceId: entry.deviceId,
      requestId: crypto.randomUUID(),
    }));
    const entries: DeviceCliBatchEntry[] = [];
    let failure: string | undefined;
    try {
      // Each chunk is independent: one failed request leaves the others sent.
      for (let i = 0; i < targets.length; i += DEVICE_CLI_BATCH_MAX_TARGETS) {
        const chunk = targets.slice(i, i + DEVICE_CLI_BATCH_MAX_TARGETS);
        try {
          entries.push(...(await deviceService.updateClis({ targets: chunk })));
        } catch (error) {
          failure = (error as Error).message;
          // Unknown whether this chunk reached the devices; a fresh check tells.
          entries.push(
            ...chunk.map(({ deviceId }): DeviceCliBatchEntry => ({
              deviceId,
              message: failure,
              outcome: 'failed',
            })),
          );
        }
      }
      lastFollow.current = {};
      setTimedOut(false);
      setSendError(failure);
      setBatch({ entries, id: crypto.randomUUID() });
    } finally {
      lock.current = false;
      setSending(false);
    }
  };

  /** Start over from a fresh check; a device updated meanwhile shows as up to date. */
  const recheck = () => {
    if (lock.current) return;
    lastFollow.current = {};
    setBatch(undefined);
    setSendError(undefined);
    setTimedOut(false);
    setRunId(crypto.randomUUID());
  };

  return {
    phase,
    planError: plan.data ? undefined : (plan.error as Error | undefined),
    recheck,
    retryPlan: () => plan.mutate(),
    rows,
    sendError,
    summary,
    update,
  };
};
