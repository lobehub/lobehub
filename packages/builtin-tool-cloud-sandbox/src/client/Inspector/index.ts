import { CloudSandboxApiName } from '../../types';
import { EditLocalFileInspector } from './EditLocalFile';
import { ExecuteCodeInspector } from './ExecuteCode';
import { ExportFileInspector } from './ExportFile';
import { GlobLocalFilesInspector } from './GlobLocalFiles';
import { GrepContentInspector } from './GrepContent';
import { ListLocalFilesInspector } from './ListLocalFiles';
import { MoveLocalFilesInspector } from './MoveLocalFiles';
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
  [CloudSandboxApiName.exportFile]: ExportFileInspector,
  [CloudSandboxApiName.globLocalFiles]: GlobLocalFilesInspector,
  [CloudSandboxApiName.grepContent]: GrepContentInspector,
  [CloudSandboxApiName.listLocalFiles]: ListLocalFilesInspector,
  [CloudSandboxApiName.moveLocalFiles]: MoveLocalFilesInspector,
  [CloudSandboxApiName.readLocalFile]: ReadLocalFileInspector,
  [CloudSandboxApiName.runCommand]: RunCommandInspector,
  [CloudSandboxApiName.searchLocalFiles]: SearchLocalFilesInspector,
  [CloudSandboxApiName.writeLocalFile]: WriteLocalFileInspector,
};
