/** Recognize drive-qualified paths and UNC paths from a remote Windows device. */
export const isWindowsDevicePath = (path: string): boolean =>
  /^[a-z]:[/\\]/i.test(path) || path.startsWith('\\\\') || path.startsWith('//');

/** Validate one child folder, using the target device's naming rules. */
export const isValidDirectoryName = (name: string, parentPath = ''): boolean => {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) return false;
  if (!isWindowsDevicePath(parentPath)) return true;

  // https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001F]/.test(name) || /[ .]$/.test(name)) return false;
  return !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name);
};
