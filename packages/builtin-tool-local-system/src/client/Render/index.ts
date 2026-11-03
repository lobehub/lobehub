import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';

import { LocalSystemApiName } from '../..';
import EditLocalFile from './EditLocalFile';
import ListFiles from './ListFiles';
import MoveLocalFiles from './MoveLocalFiles';
import ReadLocalFile from './ReadLocalFile';
import SearchFiles from './SearchFiles';
import WriteFile from './WriteFile';

/**
 * Local System Render Components Registry
 *
 * Register each component under both the new short API name (used going
 * forward) and the legacy long name (kept so old DB messages with
 * apiName: 'readLocalFile' etc. still render after the rename).
 */
export const LocalSystemRenders = {
  [LocalSystemApiName.editFile]: EditLocalFile,
  [LocalSystemApiName.listFiles]: ListFiles,
  [LocalSystemApiName.moveFiles]: MoveLocalFiles,
  [LocalSystemApiName.readFile]: ReadLocalFile,
  [LocalSystemApiName.runCommand]: RunCommandRender,
  [LocalSystemApiName.searchFiles]: SearchFiles,
  [LocalSystemApiName.writeFile]: WriteFile,
  // Legacy aliases — keep these so historical messages keep rendering
  editLocalFile: EditLocalFile,
  listLocalFiles: ListFiles,
  moveLocalFiles: MoveLocalFiles,
  readLocalFile: ReadLocalFile,
  searchLocalFiles: SearchFiles,
  writeLocalFile: WriteFile,
};
