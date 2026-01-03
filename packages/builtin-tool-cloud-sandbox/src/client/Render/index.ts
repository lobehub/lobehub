import { CloudSandboxApiName } from '../../types';
import EditLocalFile from './EditLocalFile';
import ExecuteCode from './ExecuteCode';
import ExportFile from './ExportFile';
import ListFiles from './ListFiles';
import MoveLocalFiles from './MoveLocalFiles';
import ReadLocalFile from './ReadLocalFile';
import RunCommand from './RunCommand';
import SearchFiles from './SearchFiles';
import WriteFile from './WriteFile';

/**
 * Cloud Sandbox Render Components Registry
 */
export const CloudSandboxRenders = {
  [CloudSandboxApiName.editLocalFile]: EditLocalFile,
  [CloudSandboxApiName.executeCode]: ExecuteCode,
  [CloudSandboxApiName.exportFile]: ExportFile,
  [CloudSandboxApiName.listLocalFiles]: ListFiles,
  [CloudSandboxApiName.moveLocalFiles]: MoveLocalFiles,
  [CloudSandboxApiName.readLocalFile]: ReadLocalFile,
  [CloudSandboxApiName.runCommand]: RunCommand,
  [CloudSandboxApiName.searchLocalFiles]: SearchFiles,
  [CloudSandboxApiName.writeLocalFile]: WriteFile,
};

// Export API names for use in other modules

export { CloudSandboxApiName } from '../../types';
