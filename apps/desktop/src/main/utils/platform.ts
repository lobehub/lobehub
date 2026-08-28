const getDevelopmentOverride = (): boolean | undefined => {
  if (!('ELECTRON_IS_DEV' in process.env)) return undefined;
  return Number.parseInt(process.env.ELECTRON_IS_DEV ?? '', 10) === 1;
};

export const dev = (): boolean =>
  getDevelopmentOverride() ??
  Boolean(process.defaultApp || /node_modules[\\/]electron[\\/]/.test(process.execPath));

export const linux = (): boolean => process.platform === 'linux';

export const macOS = (): boolean => process.platform === 'darwin';

export const windows = (): boolean => process.platform === 'win32';
