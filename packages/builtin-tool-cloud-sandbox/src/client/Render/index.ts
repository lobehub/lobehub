import { LocalSystemRenders } from '@lobechat/builtin-tool-local-system/client';
import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';

import { CloudSandboxApiName } from '../../types';
import ExecuteCode from './ExecuteCode';
import ExportFile from './ExportFile';

/**
 * Cloud Sandbox Render Components Registry
 *
 * Reuses local-system renders for shared file/shell operations.
 * Only cloud-specific tools (executeCode, exportFile) have their own renders.
 */
export const CloudSandboxRenders = {
  [CloudSandboxApiName.editLocalFile]: LocalSystemRenders.editLocalFile,
  [CloudSandboxApiName.executeCode]: ExecuteCode,
  [CloudSandboxApiName.exportFile]: ExportFile,
  [CloudSandboxApiName.listLocalFiles]: LocalSystemRenders.listLocalFiles,
  [CloudSandboxApiName.moveLocalFiles]: LocalSystemRenders.moveLocalFiles,
  [CloudSandboxApiName.readLocalFile]: LocalSystemRenders.readLocalFile,
  [CloudSandboxApiName.runCommand]: RunCommandRender,
  [CloudSandboxApiName.searchLocalFiles]: LocalSystemRenders.searchLocalFiles,
  [CloudSandboxApiName.writeLocalFile]: LocalSystemRenders.writeLocalFile,
};

// Export API names for use in other modules

export { CloudSandboxApiName } from '../../types';
