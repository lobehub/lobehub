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
