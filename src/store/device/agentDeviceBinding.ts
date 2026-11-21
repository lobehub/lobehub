import { mutate } from '@/libs/swr';

/**
 * SWR cache key of one agent's resolved device binding (see
 * `useAgentDeviceBinding`). `useClientDataSWR` appends the active workspace id,
 * so the key stays an array and every workspace context matches on `[0]`.
 *
 * A leaf module on purpose: the agent and user stores call
 * {@link refreshAgentDeviceBindings} after a routing write, and importing the
 * hook (which imports those stores) from them would close a module cycle.
 */
export const AGENT_DEVICE_BINDING_SWR_KEY = 'agent-device-binding';

/**
 * Re-resolve every cached agent device binding. The binding the server
 * resolves for the caller changes whenever an agent's execution target or
 * device changes, or the caller's own per-agent device override does — call
 * this after those writes settle so a mounted sidebar does not keep showing
 * the previous device's status until the next focus or remount.
 */
export const refreshAgentDeviceBindings = () =>
  mutate((key: unknown) => Array.isArray(key) && key[0] === AGENT_DEVICE_BINDING_SWR_KEY);
