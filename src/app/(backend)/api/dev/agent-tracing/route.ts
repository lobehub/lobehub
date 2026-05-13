import { agentTracingAPIHandler } from '@/server/api-runtime/dev';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

export const GET = createNextAPIRouteHandler('api-dev-agent-tracing', agentTracingAPIHandler);
