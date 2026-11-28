/**
 * Device operations a person starts outside an agent run: the interactive
 * terminal, file access and port exposure. The open-source build keeps no
 * record of them; a deployment that needs an audit trail overrides this
 * module through its own `@/business/server/...` mapping.
 */

/** One device operation, reported after the device accepted it. */
export interface DeviceOperationRecord {
  /** `devices.deviceId` the operation ran on. */
  deviceId: string;
  /** The raw procedure input, as the caller sent it. May hold file content or terminal input. */
  input: Record<string, unknown>;
  /** The tRPC procedure, e.g. `device.writeTerminal`. */
  operation: string;
  /** Who started it. */
  userId: string;
  /** Set when the call ran in a workspace. */
  workspaceId?: string;
}

/**
 * Called after an audited device operation (terminal input, file reads and
 * writes, port exposure) succeeds. It runs after the response is sent, so it must not be relied on
 * to block anything; a rejection is logged and ignored.
 */
export const recordDeviceOperation = async (_record: DeviceOperationRecord): Promise<void> => {};
