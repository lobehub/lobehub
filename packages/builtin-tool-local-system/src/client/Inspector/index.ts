import { LocalSystemApiName } from '../..';
import { EditLocalFileInspector } from './EditLocalFile';
import { GlobLocalFilesInspector } from './GlobLocalFiles';
import { GrepContentInspector } from './GrepContent';
import { ReadLocalFileInspector } from './ReadLocalFile';
import { RunCommandInspector } from './RunCommand';
import { SearchLocalFilesInspector } from './SearchLocalFiles';

/**
 * Local System Inspector Components Registry
 */
export const LocalSystemInspectors = {
  [LocalSystemApiName.editLocalFile]: EditLocalFileInspector,
  [LocalSystemApiName.globLocalFiles]: GlobLocalFilesInspector,
  [LocalSystemApiName.grepContent]: GrepContentInspector,
  [LocalSystemApiName.readLocalFile]: ReadLocalFileInspector,
  [LocalSystemApiName.runCommand]: RunCommandInspector,
  [LocalSystemApiName.searchLocalFiles]: SearchLocalFilesInspector,
};
