import { mkdirSync, statSync } from 'node:fs';

export const makeSureDirExist = (dir: string) => {
  try {
    statSync(dir);
  } catch {
    // Use recursive: true, no effect if directory exists, create if it doesn't
    try {
      mkdirSync(dir, { recursive: true });
    } catch (mkdirError: unknown) {
      // Throw error if directory creation fails (e.g., permission issues)
      const message = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
      throw new Error(`Could not create target directory: ${dir}. Error: ${message}`, {
        cause: mkdirError,
      });
    }
  }
};
