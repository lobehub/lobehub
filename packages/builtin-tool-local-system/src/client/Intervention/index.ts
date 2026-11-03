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
 *
 * Register each component under both the new short API name and the legacy
 * long name so old DB messages keep rendering after the rename.
 */
export const LocalSystemInterventions = {
  [LocalSystemApiName.editFile]: EditLocalFile,
  [LocalSystemApiName.globFiles]: GlobLocalFiles,
  [LocalSystemApiName.grepContent]: GrepContent,
  [LocalSystemApiName.listFiles]: ListLocalFiles,
  [LocalSystemApiName.moveFiles]: MoveLocalFiles,
  [LocalSystemApiName.readFile]: ReadLocalFile,
  [LocalSystemApiName.runCommand]: RunCommand,
  [LocalSystemApiName.searchFiles]: SearchLocalFiles,
  [LocalSystemApiName.writeFile]: WriteFile,
  // Legacy aliases — keep these so historical messages keep rendering.
  // `renameLocalFile` is kept here even though the new tool surface no longer
  // exposes a rename API (rename is now done via `moveFiles`).
  editLocalFile: EditLocalFile,
  globLocalFiles: GlobLocalFiles,
  listLocalFiles: ListLocalFiles,
  moveLocalFiles: MoveLocalFiles,
  readLocalFile: ReadLocalFile,
  renameLocalFile: RenameLocalFile,
  searchLocalFiles: SearchLocalFiles,
  writeLocalFile: WriteFile,
};
