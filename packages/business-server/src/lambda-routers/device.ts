import { router } from '@/libs/trpc/lambda';

/**
 * Extra procedures merged into the lambda `device` router. Empty in the
 * open-source build; downstream builds override this module through their own
 * `@/business/server/...` mapping.
 */
export const businessDeviceRouter = router({});
