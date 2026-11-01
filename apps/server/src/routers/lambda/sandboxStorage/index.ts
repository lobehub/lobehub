import { mergeRouters } from '@/libs/trpc/lambda';

import { filesRouter } from './files';
import { instanceBuildRouter } from './instanceBuild';
import { instancesRouter } from './instances';
import { legacyEnvironmentRouter } from './legacyEnvironment';
import { storageRouter } from './storage';

/**
 * Browsing and managing the user's network drives, and the environment
 * directories (instances) initialized on them.
 *
 * The drive lives on a volume mounted into the sandbox runtime, so every call
 * here runs inside a sandbox session on the caller's behalf. Paths are always
 * relative to the drive's root; the absolute mount path never reaches a
 * client, which leaves nothing for one to smuggle back.
 *
 * The environment definitions and the GitHub pickers moved to the
 * `environment` router, which needs no drive. They are still answered here
 * under their released paths — the same procedures, not copies — so a desktop
 * build or a cached web client from before the move keeps working until it
 * updates; `createEnvironment` there keeps its released `withDefaultInstance`.
 */
export const sandboxStorageRouter = mergeRouters(
  filesRouter,
  storageRouter,
  instancesRouter,
  instanceBuildRouter,
  legacyEnvironmentRouter,
);

export type SandboxStorageRouter = typeof sandboxStorageRouter;
