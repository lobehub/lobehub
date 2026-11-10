import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { AGENT_DEVICE_BINDING_SWR_KEY } from '@/store/device/agentDeviceBinding';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

type Waiter = { reject: (error: unknown) => void; resolve: (deviceId: string | null) => void };

let pending = new Map<string, Waiter[]>();

const flush = async () => {
  const batch = pending;
  pending = new Map();

  try {
    const bindings = await deviceService.getAgentDeviceBindings([...batch.keys()]);
    for (const [agentId, waiters] of batch) {
      for (const waiter of waiters) waiter.resolve(bindings[agentId] ?? null);
    }
  } catch (error) {
    for (const waiters of batch.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
  }
};

/**
 * Coalesce every agent asked for in the same tick into ONE server read. Each
 * agent group asks for its own binding, but a sidebar can mount a hundred of
 * them at once, and a request per agent would be a hundred logical reads.
 */
export const loadAgentDeviceBinding = (agentId: string): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const waiters = pending.get(agentId);
    if (waiters) waiters.push({ reject, resolve });
    else {
      const isFirst = pending.size === 0;
      pending.set(agentId, [{ reject, resolve }]);
      if (isFirst) setTimeout(() => void flush(), 0);
    }
  });

/**
 * The device an agent runs on for the caller: a device id, `null` when it runs
 * on no device (sandbox, none, auto, unbound), `undefined` until known.
 *
 * Resolved server-side (stored config merged with the caller's own override,
 * keeping only the `device` / `local` targets), so a lingering `boundDeviceId`
 * of an agent moved to the sandbox never shows up, and a public workspace
 * agent never reports the author's binding before the caller's override lands.
 */
export const useAgentDeviceBinding = (agentId: string | undefined) => {
  const isLogin = useUserStore(authSelectors.isLogin);

  return useClientDataSWR<string | null>(
    isLogin && agentId ? [AGENT_DEVICE_BINDING_SWR_KEY, agentId] : null,
    () => loadAgentDeviceBinding(agentId!),
  );
};
