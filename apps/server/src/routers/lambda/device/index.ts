import { mergeRouters, router } from '@/libs/trpc/lambda';

import { workspaceDeviceWorkingDirProcedures } from '../deviceWorkspaceWorkingDirs';
import { agentsRouter } from './agents';
import { gitRouter } from './git';
import { operateRouter } from './operate';
import { projectFilesRouter } from './projectFiles';
import { registryRouter } from './registry';
import { workspaceRouter } from './workspace';

export const deviceRouter = mergeRouters(
  agentsRouter,
  registryRouter,
  gitRouter,
  projectFilesRouter,
  operateRouter,
  workspaceRouter,
  router({
    ...workspaceDeviceWorkingDirProcedures,
  }),
);
