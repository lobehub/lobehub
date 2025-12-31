import { CodeInterpreterApiName } from '../../types';
import EditLocalFile from './EditLocalFile';
import ExecuteCode from './ExecuteCode';
import MoveLocalFiles from './MoveLocalFiles';
import RunCommand from './RunCommand';
import WriteFile from './WriteFile';

/**
 * Cloud Sandbox Intervention Components Registry
 */
export const CodeInterpreterInterventions = {
  [CodeInterpreterApiName.editLocalFile]: EditLocalFile,
  [CodeInterpreterApiName.executeCode]: ExecuteCode,
  [CodeInterpreterApiName.moveLocalFiles]: MoveLocalFiles,
  [CodeInterpreterApiName.runCommand]: RunCommand,
  [CodeInterpreterApiName.writeLocalFile]: WriteFile,
};
