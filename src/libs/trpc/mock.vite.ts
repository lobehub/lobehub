/**
 * Browser-only stub to stop Vite SPA warmup from traversing the server router graph.
 * The real implementation is only valid in server and test environments.
 */
export const createCaller = () => {
  throw new Error('`@/libs/trpc/mock` is server-only and unavailable in the Vite browser build.');
};
