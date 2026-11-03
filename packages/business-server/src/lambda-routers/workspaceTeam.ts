import { router } from '@/libs/trpc/lambda';

// Cloud overrides this at the same path with the real workspaceTeamRouter.
// No submodule (open-source) UI consumes workspace teams, so the stub declares
// no procedures.
export const workspaceTeamRouter = router({});
