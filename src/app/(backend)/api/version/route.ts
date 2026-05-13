import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { versionAPIHandler } from '@/server/api-runtime/version';

export type { VersionResponseData } from '@/server/api-runtime/version';

export const GET = createNextAPIRouteHandler('api-version', versionAPIHandler);
