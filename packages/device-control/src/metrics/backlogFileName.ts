import { createHash } from 'node:crypto';

/**
 * File name for a device's unsent-sample backlog. Device ids can be arbitrary
 * user strings (`lh connect --device-id`), so the readable prefix alone is
 * lossy (`prod/api` and `prod:api` both sanitize to `prod_api`); the hash of
 * the raw id keeps distinct ids in distinct files, also on case-insensitive
 * file systems.
 */
export const deviceMetricsBacklogFileName = (deviceId: string): string => {
  const readable = deviceId.replaceAll(/[^\w-]/g, '_').slice(0, 64);
  const digest = createHash('sha256').update(deviceId).digest('hex').slice(0, 16);
  return `${readable}-${digest}.json`;
};
