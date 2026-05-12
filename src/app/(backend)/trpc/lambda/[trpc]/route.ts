import { lambdaTRPCHandler } from '@/server/trpc-runtime/lambda';
import { createNextTRPCRouteHandler } from '@/server/trpc-runtime/next';

const handler = createNextTRPCRouteHandler('lambda', lambdaTRPCHandler);

export { handler as GET, handler as POST };
