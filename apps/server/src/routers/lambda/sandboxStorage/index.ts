import { router } from '@/libs/trpc/lambda';

import { environmentsProcedures } from './environments';
import { filesProcedures } from './files';
import { githubProcedures } from './github';
import { instanceBuildProcedures } from './instanceBuild';
import { instancesProcedures } from './instances';
import { storageProcedures } from './storage';

/**
 * Browsing and managing the persistent sandbox workspace.
 *
 * The workspace lives on a volume mounted into the sandbox runtime, so every
 * call here runs inside a sandbox session on the caller's behalf. Paths are
 * always relative to the workspace root; the absolute mount path never reaches
 * a client, which leaves nothing for one to smuggle back.
 */

export const sandboxStorageRouter = router({
  ...filesProcedures,
  ...storageProcedures,
  ...instancesProcedures,
  ...instanceBuildProcedures,
  ...environmentsProcedures,
  ...githubProcedures,
});

export type SandboxStorageRouter = typeof sandboxStorageRouter;
