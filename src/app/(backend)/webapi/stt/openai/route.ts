import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { openAISTTAPIHandler } from '@/server/api-runtime/speech';

export const POST = createNextAPIRouteHandler('webapi-stt-openai', openAISTTAPIHandler, {
  honoRuntime: 'root',
});
