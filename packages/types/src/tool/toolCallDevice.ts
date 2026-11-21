/**
 * Optional argument of a device tool call (`lobe-local-system`) that runs THAT
 * one call on another of the user's devices. Omitted, the call runs on the
 * run's device (the one picked in the chat input). It never rebinds the topic
 * or the agent, and a device that cannot be used fails the call instead of
 * falling back to another machine.
 */
export const TOOL_CALL_DEVICE_ARG = 'device';

/**
 * The device that actually executed a device tool call, stored on the call's
 * result state (`executionDevice`) so the user can check where it ran.
 */
export interface ToolExecutionDevice {
  deviceId: string;
  hostname?: string;
  /** The user-set alias from the device settings, when there is one. */
  name?: string;
  /** Whether the call named this device through its `device` argument. */
  requested?: boolean;
  scope?: 'personal' | 'workspace';
}

export interface ToolExecutionDeviceState {
  executionDevice?: ToolExecutionDevice;
}
