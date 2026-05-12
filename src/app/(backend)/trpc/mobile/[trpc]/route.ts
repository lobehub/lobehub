import { mobileTRPCHandler } from '@/server/trpc-runtime/mobile';
import { createNextTRPCRouteHandler } from '@/server/trpc-runtime/next';

const handler = createNextTRPCRouteHandler('mobile', mobileTRPCHandler);

export { handler as GET, handler as POST };
