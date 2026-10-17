import { router } from '@/libs/trpc/lambda';

import { workspaceDeviceWorkingDirProcedures } from '../deviceWorkspaceWorkingDirs';
import { agentsProcedures } from './agents';
import { gitProcedures } from './git';
import { operateProcedures } from './operate';
import { projectFilesProcedures } from './projectFiles';
import { registryProcedures } from './registry';
import { workspaceProcedures } from './workspace';

export const deviceRouter = router({
  ...workspaceDeviceWorkingDirProcedures,
  ...agentsProcedures,
  ...registryProcedures,
  ...gitProcedures,
  ...projectFilesProcedures,
  ...operateProcedures,
  ...workspaceProcedures,
});
