import { router } from '@/libs/trpc/lambda';

// Cloud overrides this at the same path with the real workspaceRouter backed by cloudDB.
export const workspaceRouter = router({});
