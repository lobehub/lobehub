import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { microsoftTTSAPIHandler } from '@/server/api-runtime/speech';

export const POST = createNextAPIRouteHandler('webapi-tts-microsoft', microsoftTTSAPIHandler, {
  honoRuntime: 'root',
});
