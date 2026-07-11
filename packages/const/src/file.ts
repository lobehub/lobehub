/**
 * System files to be filtered out when listing directory contents
 */
export const SYSTEM_FILES_BLACKLIST = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.localized',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.Spotlight-V100',
  '.fseventsd',
  '.Trashes',
];

export const FILE_UPLOAD_BLACKLIST = SYSTEM_FILES_BLACKLIST;

export const MAX_UPLOAD_FILE_COUNT = 10;

/**
 * DataTransfer MIME type used when dragging a file/folder row from the working
 * sidebar file tree into the chat input. A custom (non-`Files`) type so the
 * file-upload drop zone ignores it — it only reacts to `Files` — and the drop
 * handler turns it into a `<localFile />` mention instead of uploading a blob.
 */
export const WORKSPACE_FILE_DRAG_MIME = 'application/x-lobe-workspace-file';
