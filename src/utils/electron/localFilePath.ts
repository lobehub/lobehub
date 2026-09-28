import debug from 'debug';

const log = debug('lobe-client:electron:local-file-path');

export const getElectronLocalFilePath = (file: File): string | null => {
  const webUtils = (
    globalThis as unknown as {
      window?: { electron?: { webUtils?: { getPathForFile?: (file: File) => string } } };
    }
  ).window?.electron?.webUtils;
  if (!webUtils?.getPathForFile) {
    log('webUtils.getPathForFile unavailable on window.electron — local path cannot be resolved');
    return null;
  }
  try {
    const result = webUtils.getPathForFile(file);
    if (!result) log('webUtils.getPathForFile returned empty for %s', file.name);
    return result || null;
  } catch (error) {
    log('webUtils.getPathForFile threw for %s: %O', file.name, error);
    return null;
  }
};
