import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { edgeTTSAPIHandler } from '@/server/api-runtime/speech';

export const POST = createNextAPIRouteHandler('webapi-tts-edge', edgeTTSAPIHandler, {
  honoRuntime: 'root',
});
