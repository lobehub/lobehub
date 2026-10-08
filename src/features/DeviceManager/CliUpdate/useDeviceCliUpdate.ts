import type { DeviceCliUpdateOperation, DeviceCliUpdateStateResult } from '@lobechat/types';
import { useEffect, useRef, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

import { refreshDeviceList } from '../const';
import { deriveCliUpdateView } from './deriveCliUpdateView';

export const useDeviceCliUpdate = (deviceId: string, live: boolean, canEdit: boolean) => {
  const workspaceId = useActiveWorkspaceId();
  const [operation, setOperation] = useState<DeviceCliUpdateOperation>();
  const [timedOut, setTimedOut] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [ambiguous, setAmbiguous] = useState(false);
  const [checked, setChecked] = useState(false);
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const swr = useClientDataSWR<DeviceCliUpdateStateResult>(
    canEdit && (live || operation) ? deviceKeys.cliUpdateState(workspaceId, deviceId) : null,
    () => deviceService.getCliUpdateState({ deviceId }),
    {
      refreshInterval: (result) =>
        deriveCliUpdateView(result, operation, timedOut) === 'pending' ? 3000 : 0,
      revalidateOnFocus: false,
      shouldRetryOnError: !!operation && !timedOut,
      errorRetryCount: 100,
      errorRetryInterval: 3000,
    },
  );
  const state = swr.data?.status === 'ok' ? swr.data.state : undefined;
  const observedOperation = operation ?? state?.operation;
  const view = deriveCliUpdateView(swr.data, operation, timedOut);
  useEffect(() => {
    if (view === 'success' || view === 'failed') setAmbiguous(false);
    if (view === 'success') void refreshDeviceList();
  }, [view]);
  useEffect(() => {
    if (!operation && state?.operation && view === 'pending') setOperation(state.operation);
  }, [operation, state?.operation, view]);
  useEffect(() => {
    if (!observedOperation || timedOut || view !== 'pending') return;
    const timer = setTimeout(() => setTimedOut(true), 5 * 60_000);
    return () => clearTimeout(timer);
  }, [observedOperation?.id, timedOut, view]);

  const run = async (action: () => Promise<DeviceCliUpdateStateResult>, destructive: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setRequesting(true);
    setRequestError(undefined);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (destructive) setAmbiguous(result.status === 'unavailable');
      if (destructive && result.status === 'unsupported') setOperation(undefined);
      if (result.status === 'rejected') {
        setOperation(undefined);
        setRequestError(result.message);
        await swr.mutate();
        return;
      }
      if (result.status === 'ok') {
        setOperation(destructive ? result.state.operation : undefined);
      }
      await swr.mutate(result, { revalidate: false });
    } catch (error) {
      console.error(error);
      if (mounted.current) {
        setRequestError((error as Error).message);
        if (destructive) setAmbiguous(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setRequesting(false);
    }
  };
  const allowed = canEdit && live && state?.supported && state.activeTasks === 0;
  // A confirmation can outlive a presence/permission change or scope unmount.
  const currentAccess = useRef({ allowed, canEdit, live });
  currentAccess.current = { allowed, canEdit, live };
  const restart = (update: boolean) => {
    if (
      !mounted.current ||
      !currentAccess.current.allowed ||
      !state ||
      !allowed ||
      lock.current ||
      view === 'pending' ||
      view === 'timedOut' ||
      ambiguous
    )
      return;
    const next: DeviceCliUpdateOperation = {
      fromInstanceId: state.instanceId,
      id: crypto.randomUUID(),
      kind: update ? 'update' : 'restart',
      stage: update ? 'updating' : 'restarting',
      targetVersion: update ? (state.latestVersion ?? state.currentVersion) : state.currentVersion,
    };
    setOperation(next);
    setTimedOut(false);
    return run(() => deviceService.restartCli({ deviceId, requestId: next.id, update }), true);
  };
  return {
    allowed,
    ambiguous,
    checked,
    operation: observedOperation,
    requesting,
    restart,
    check: () => {
      if (
        !mounted.current ||
        !currentAccess.current.canEdit ||
        !currentAccess.current.live ||
        !canEdit ||
        !live ||
        view === 'pending' ||
        view === 'timedOut' ||
        ambiguous ||
        lock.current
      )
        return;
      setTimedOut(false);
      setChecked(true);
      return run(() => deviceService.checkCliUpdate({ deviceId }), false);
    },
    error:
      requestError ??
      (swr.error as Error | undefined)?.message ??
      (swr.data?.status !== 'ok' ? swr.data?.message : undefined),
    refreshing: swr.isValidating,
    retryRead: () => swr.mutate(),
    retryCommand: () => {
      if (
        !mounted.current ||
        !currentAccess.current.allowed ||
        !allowed ||
        !operation ||
        (!ambiguous && view !== 'timedOut')
      )
        return;
      setTimedOut(false);
      return run(
        () =>
          deviceService.restartCli({
            deviceId,
            requestId: operation.id,
            update: operation.kind === 'update',
          }),
        true,
      );
    },
    state,
    view,
  };
};
