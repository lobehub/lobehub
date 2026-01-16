import { CloudSandboxApiName } from '../../types';
import { EditLocalFileInspector } from './EditLocalFile';
import { ExecuteCodeInspector } from './ExecuteCode';
import { GlobLocalFilesInspector } from './GlobLocalFiles';
import { GrepContentInspector } from './GrepContent';
import { ListLocalFilesInspector } from './ListLocalFiles';
import { ReadLocalFileInspector } from './ReadLocalFile';
import { RunCommandInspector } from './RunCommand';
import { SearchLocalFilesInspector } from './SearchLocalFiles';
import { WriteLocalFileInspector } from './WriteLocalFile';

/**
 * Code Interpreter Inspector Components Registry
 */
export const CloudSandboxInspectors = {
  [CloudSandboxApiName.editLocalFile]: EditLocalFileInspector,
  [CloudSandboxApiName.executeCode]: ExecuteCodeInspector,
  [CloudSandboxApiName.globLocalFiles]: GlobLocalFilesInspector,
  [CloudSandboxApiName.grepContent]: GrepContentInspector,
  [CloudSandboxApiName.listLocalFiles]: ListLocalFilesInspector,
  [CloudSandboxApiName.readLocalFile]: ReadLocalFileInspector,
  [CloudSandboxApiName.runCommand]: RunCommandInspector,
  [CloudSandboxApiName.searchLocalFiles]: SearchLocalFilesInspector,
  [CloudSandboxApiName.writeLocalFile]: WriteLocalFileInspector,
};
