import { CloudSandboxApiName } from '../../types';
import EditLocalFile from './EditLocalFile';
import ExecuteCode from './ExecuteCode';
import MoveLocalFiles from './MoveLocalFiles';
import RunCommand from './RunCommand';
import WriteFile from './WriteFile';

/**
 * Cloud Sandbox Intervention Components Registry
 *
 * Each component is also registered under the legacy long API name so old DB
 * messages with apiName like 'editLocalFile' still resolve after the rename.
 */
export const CloudSandboxInterventions = {
  [CloudSandboxApiName.editFile]: EditLocalFile,
  [CloudSandboxApiName.executeCode]: ExecuteCode,
  [CloudSandboxApiName.moveFiles]: MoveLocalFiles,
  [CloudSandboxApiName.runCommand]: RunCommand,
  [CloudSandboxApiName.writeFile]: WriteFile,
  // Legacy aliases — keep these so historical messages keep rendering
  editLocalFile: EditLocalFile,
  moveLocalFiles: MoveLocalFiles,
  writeLocalFile: WriteFile,
};
