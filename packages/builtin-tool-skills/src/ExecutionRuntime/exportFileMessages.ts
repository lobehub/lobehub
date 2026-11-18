/**
 * Why a path can never name an exportable file, or `undefined` when it might.
 * Checked before the sandbox call so "the path is malformed" and "the file is
 * not there" reach the model as different answers.
 */
export const getInvalidExportPathReason = (path: unknown): string | undefined => {
  if (typeof path !== 'string' || path.trim() === '') return 'the path is empty';
  if (path.includes('\0')) return 'the path contains a NUL character';
  if (path.endsWith('/')) return 'the path names a directory, not a file';
};

const NOT_FOUND_PATTERN = /file not found|no such file|ENOENT/i;

const getErrorMessage = (error: unknown): string | undefined => {
  if (typeof error === 'string') return error || undefined;
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
};

/** The model-facing text for a failed export, carrying the sandbox's reason. */
export const formatExportFailure = (path: string, filename: string, error: unknown): string => {
  const reason = getErrorMessage(error);

  if (reason && NOT_FOUND_PATTERN.test(reason)) {
    return [
      `Failed to export file "${filename}": File not found at path "${path}".`,
      `Sandbox reported: ${reason}`,
      'The export channel works; the file is not at that path. Run `realpath <file>` (or `ls`) with runCommand in the same sandbox and pass the absolute path it prints.',
    ].join('\n');
  }

  return `Failed to export file "${filename}" from path "${path}": ${reason || 'unknown error'}`;
};
