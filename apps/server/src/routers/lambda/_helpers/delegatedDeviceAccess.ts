import { TRPCError } from '@trpc/server';

/**
 * Whether the caller's token was minted for a run that may not use devices
 * (`device_access: 'denied'`, see `signUserJWT`) — an external bot sender's or
 * a share visitor's sandbox. Anything such a run starts or queues keeps that
 * denial, whatever the request itself says.
 */
export const delegatedDeviceAccessDeniedOf = (ctx: { oidcAuth?: Record<string, any> | null }) =>
  ctx.oidcAuth?.device_access === 'denied';

/** Such a request cannot name a device to run on. */
export const assertNoDeviceForDeniedRun = (
  denied: boolean,
  deviceId: string | null | undefined,
) => {
  if (denied && deviceId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'This request comes from a run that may not use devices, so it cannot start a run on a device.',
    });
  }
};
