import { useEffect, useRef, useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

const POLL_INTERVAL_MS = 2000;

interface UseDeviceAgentCliUpdateParams {
  agentType: string;
  deviceId: string;
  /** Only a device that can update the CLI, for a caller who may operate it. */
  enabled: boolean;
  /** Called once a running update ends, to re-scan the CLI version. */
  onFinish: () => void;
}

/**
 * A remote update of an agent CLI on a device: start it, then poll its job
 * while it runs. The latest job is read on mount too, so an update started
 * from another tab or member shows as running here.
 */
export const useDeviceAgentCliUpdate = ({
  agentType,
  deviceId,
  enabled,
  onFinish,
}: UseDeviceAgentCliUpdateParams) => {
  const [starting, setStarting] = useState(false);
  const [requestError, setRequestError] = useState<string>();

  const swr = useClientDataSWR(
    enabled ? deviceKeys.agentCliUpdate(deviceId, agentType) : null,
    () => deviceService.getAgentCliUpdate({ agentType, deviceId }),
    {
      refreshInterval: (result) =>
        result?.status === 'ok' && result.job?.status === 'running' ? POLL_INTERVAL_MS : 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const job = swr.data?.status === 'ok' ? swr.data.job : null;

  // A job that stops running — or that a poll no longer finds — has changed
  // the CLI, so the version shown must be read again.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const previousStatus = useRef(job?.status);
  useEffect(() => {
    if (previousStatus.current === 'running' && job?.status !== 'running') onFinishRef.current();
    previousStatus.current = job?.status;
  }, [job?.status]);

  const start = async () => {
    if (starting || job?.status === 'running') return;
    setStarting(true);
    setRequestError(undefined);
    try {
      const result = await deviceService.startAgentCliUpdate({ agentType, deviceId });
      if (result.status === 'ok') await swr.mutate(result, { revalidate: false });
      else setRequestError(result.message);
    } catch (error) {
      setRequestError((error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return {
    error: requestError ?? (job?.status === 'failed' ? job.error : undefined),
    failed: !!requestError || job?.status === 'failed',
    job,
    start,
    starting,
  };
};
