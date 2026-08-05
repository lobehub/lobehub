import type { OpenLocalFileParams } from './initialState';

const LOCAL_FILE_TAB_LOCAL_DEVICE = 'local';
const LOCAL_FILE_GLOBAL_SCOPE = '__global__';

export const createLocalFileScopeKey = (workingDirectory?: string): string =>
  workingDirectory || LOCAL_FILE_GLOBAL_SCOPE;

/**
 * Activation scope for sandbox tabs in topics without a working directory.
 * Sandbox tabs are visible per serving topic, so their active-tab bookkeeping
 * must be per topic too — the global scope would let unscoped topics overwrite
 * each other's activation.
 */
export const createSandboxLocalFileScopeKey = (topicId: string): string => `sandbox:${topicId}`;

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
      ? createSandboxLocalFileScopeKey(sandboxTopicId)
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
