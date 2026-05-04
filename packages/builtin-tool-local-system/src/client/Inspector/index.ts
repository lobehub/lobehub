import { LocalSystemApiName } from '../..';
import { EditLocalFileInspector } from './EditLocalFile';
import { GlobLocalFilesInspector } from './GlobLocalFiles';
import { GrepContentInspector } from './GrepContent';
import { ListLocalFilesInspector } from './ListLocalFiles';
import { MoveLocalFilesInspector } from './MoveLocalFiles';
import { ReadLocalFileInspector } from './ReadLocalFile';
import { RenameLocalFileInspector } from './RenameLocalFile';
import { RunCommandInspector } from './RunCommand';
import { SearchLocalFilesInspector } from './SearchLocalFiles';
import { WriteLocalFileInspector } from './WriteLocalFile';

/**
 * Local System Inspector Components Registry
 *
 * Register each component under both the new short API name and the legacy
 * long name so old DB messages keep rendering after the rename.
 */
export const LocalSystemInspectors = {
  [LocalSystemApiName.editFile]: EditLocalFileInspector,
  [LocalSystemApiName.globFiles]: GlobLocalFilesInspector,
  [LocalSystemApiName.grepContent]: GrepContentInspector,
  [LocalSystemApiName.listFiles]: ListLocalFilesInspector,
  [LocalSystemApiName.moveFiles]: MoveLocalFilesInspector,
  [LocalSystemApiName.readFile]: ReadLocalFileInspector,
  [LocalSystemApiName.runCommand]: RunCommandInspector,
  [LocalSystemApiName.searchFiles]: SearchLocalFilesInspector,
  [LocalSystemApiName.writeFile]: WriteLocalFileInspector,
  // Legacy aliases — keep these so historical messages keep rendering.
  // `renameLocalFile` is kept here even though the new tool surface no longer
  // exposes a rename API (rename is now done via `moveFiles`).
  editLocalFile: EditLocalFileInspector,
  globLocalFiles: GlobLocalFilesInspector,
  listLocalFiles: ListLocalFilesInspector,
  moveLocalFiles: MoveLocalFilesInspector,
  readLocalFile: ReadLocalFileInspector,
  renameLocalFile: RenameLocalFileInspector,
  searchLocalFiles: SearchLocalFilesInspector,
  writeLocalFile: WriteLocalFileInspector,
};
