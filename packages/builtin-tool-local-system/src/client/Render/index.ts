import { LocalSystemApiName } from '../..';
import EditLocalFile from './EditLocalFile';
import ListFiles from './ListFiles';
import MoveLocalFiles from './MoveLocalFiles';
import ReadLocalFile from './ReadLocalFile';
import RenameLocalFile from './RenameLocalFile';
import RunCommand from './RunCommand';
import SearchFiles from './SearchFiles';
import WriteFile from './WriteFile';

/**
 * Local System Render Components Registry
 */
export const LocalSystemRenders = {
  [LocalSystemApiName.editLocalFile]: EditLocalFile,
  [LocalSystemApiName.listLocalFiles]: ListFiles,
  [LocalSystemApiName.moveLocalFiles]: MoveLocalFiles,
  [LocalSystemApiName.readLocalFile]: ReadLocalFile,
  [LocalSystemApiName.renameLocalFile]: RenameLocalFile,
  [LocalSystemApiName.runCommand]: RunCommand,
  [LocalSystemApiName.searchLocalFiles]: SearchFiles,
  [LocalSystemApiName.writeLocalFile]: WriteFile,
};
