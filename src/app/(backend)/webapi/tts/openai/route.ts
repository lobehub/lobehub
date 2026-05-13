import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { openAITTSAPIHandler } from '@/server/api-runtime/speech';

export const POST = createNextAPIRouteHandler('webapi-tts-openai', openAITTSAPIHandler, {
  honoRuntime: 'root',
});
