import { asyncTRPCHandler } from '@/server/trpc-runtime/async';
import { createNextTRPCRouteHandler } from '@/server/trpc-runtime/next';

const handler = createNextTRPCRouteHandler('async', asyncTRPCHandler);

export { handler as GET, handler as POST };
