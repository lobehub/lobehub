import { CloudSandboxApiName } from '../../types';
import EditLocalFile from './EditLocalFile';
import ExecuteCode from './ExecuteCode';
import MoveLocalFiles from './MoveLocalFiles';
import RunCommand from './RunCommand';
import WriteFile from './WriteFile';

/**
 * Cloud Sandbox Intervention Components Registry
 */
export const CloudSandboxInterventions = {
  [CloudSandboxApiName.editLocalFile]: EditLocalFile,
  [CloudSandboxApiName.executeCode]: ExecuteCode,
  [CloudSandboxApiName.moveLocalFiles]: MoveLocalFiles,
  [CloudSandboxApiName.runCommand]: RunCommand,
  [CloudSandboxApiName.writeLocalFile]: WriteFile,
};
