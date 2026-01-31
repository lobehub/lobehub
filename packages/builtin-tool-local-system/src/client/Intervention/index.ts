import { LocalSystemApiName } from '../..';
import EditLocalFile from './EditLocalFile';
import GlobLocalFiles from './GlobLocalFiles';
import GrepContent from './GrepContent';
import ListLocalFiles from './ListLocalFiles';
import MoveLocalFiles from './MoveLocalFiles';
import ReadLocalFile from './ReadLocalFile';
import RenameLocalFile from './RenameLocalFile';
import RunCommand from './RunCommand';
import SearchLocalFiles from './SearchLocalFiles';
import WriteFile from './WriteFile';

/**
 * Local System Intervention Components Registry
 */
export const LocalSystemInterventions = {
  [LocalSystemApiName.editLocalFile]: EditLocalFile,
  [LocalSystemApiName.globLocalFiles]: GlobLocalFiles,
  [LocalSystemApiName.grepContent]: GrepContent,
  [LocalSystemApiName.listLocalFiles]: ListLocalFiles,
  [LocalSystemApiName.moveLocalFiles]: MoveLocalFiles,
  [LocalSystemApiName.readLocalFile]: ReadLocalFile,
  [LocalSystemApiName.renameLocalFile]: RenameLocalFile,
  [LocalSystemApiName.runCommand]: RunCommand,
  [LocalSystemApiName.searchLocalFiles]: SearchLocalFiles,
  [LocalSystemApiName.writeLocalFile]: WriteFile,
};
