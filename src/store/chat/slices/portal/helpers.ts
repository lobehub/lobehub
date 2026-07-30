import type { OpenLocalFileParams } from './initialState';

const LOCAL_FILE_TAB_LOCAL_DEVICE = 'local';
const LOCAL_FILE_GLOBAL_SCOPE = '__global__';

export const createLocalFileScopeKey = (workingDirectory?: string): string =>
  workingDirectory || LOCAL_FILE_GLOBAL_SCOPE;

export const createLocalFileTabId = ({
  deviceId,
  filePath,
  sandboxTopicId,
  workingDirectory,
}: OpenLocalFileParams): string =>
  [
    // Sandbox files are scoped by topic, not device — keep their tab ids from
    // colliding with a same-path file on the local machine.
    sandboxTopicId
      ? `sandbox:${sandboxTopicId}`
      : deviceId
        ? `device:${deviceId}`
        : LOCAL_FILE_TAB_LOCAL_DEVICE,
    workingDirectory,
    filePath,
  ]
    .map(encodeURIComponent)
    .join('|');

export const getLocalFileTabId = (entry: OpenLocalFileParams & { id?: string }): string =>
  entry.id ?? createLocalFileTabId(entry);
