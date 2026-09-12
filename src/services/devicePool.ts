import { lambdaClient } from '@/libs/trpc/client';

type Client = typeof lambdaClient.devicePool;

/**
 * Client boundary for persisted device-pool configuration.
 *
 * Use when:
 * - Settings reads or edits device pool policy
 *
 * Expects:
 * - The caller supplies an explicit personal/workspace scope
 *
 * Returns:
 * - Server-authorized configuration; failures propagate to the interface
 */
class DevicePoolService {
  list(input: Parameters<Client['list']['query']>[0]) {
    return lambdaClient.devicePool.list.query(input);
  }
  detail(input: Parameters<Client['detail']['query']>[0]) {
    return lambdaClient.devicePool.detail.query(input);
  }
  create(input: Parameters<Client['create']['mutate']>[0]) {
    return lambdaClient.devicePool.create.mutate(input);
  }
  update(input: Parameters<Client['update']['mutate']>[0]) {
    return lambdaClient.devicePool.update.mutate(input);
  }
  remove(input: Parameters<Client['remove']['mutate']>[0]) {
    return lambdaClient.devicePool.remove.mutate(input);
  }
  addDevice(input: Parameters<Client['addDevice']['mutate']>[0]) {
    return lambdaClient.devicePool.addDevice.mutate(input);
  }
  removeDevice(input: Parameters<Client['removeDevice']['mutate']>[0]) {
    return lambdaClient.devicePool.removeDevice.mutate(input);
  }
  saveOverride(input: Parameters<Client['saveOverride']['mutate']>[0]) {
    return lambdaClient.devicePool.saveOverride.mutate(input);
  }
}

/** Shared client service; components never call TRPC directly. */
export const devicePoolService = new DevicePoolService();
