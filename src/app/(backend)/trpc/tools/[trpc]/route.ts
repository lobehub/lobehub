import { createNextTRPCRouteHandler } from '@/server/trpc-runtime/next';
import { toolsTRPCHandler } from '@/server/trpc-runtime/tools';

const handler = createNextTRPCRouteHandler('tools', toolsTRPCHandler);

export { handler as GET, handler as POST };
