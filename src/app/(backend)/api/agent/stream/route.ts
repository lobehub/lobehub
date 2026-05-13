import { agentStreamAPIHandler } from '@/server/api-runtime/agentStream';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const GET = createNextAPIRouteHandler('api-agent-stream', agentStreamAPIHandler, {
  honoRuntime: 'root',
});
