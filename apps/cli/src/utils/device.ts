import { readStatus } from '../daemon/manager';

export function resolveLocalDeviceId(): string | undefined {
  return readStatus()?.deviceId;
}
