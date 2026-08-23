import { stat } from 'node:fs/promises';

/**
 * Whether a path is definitively absent.
 *
 * `stat` failing is not the same as the path being gone: an unreadable parent
 * (EACCES/EPERM), a symlink loop (ELOOP) or a transient fd exhaustion (EMFILE)
 * all throw for a path that exists. Reporting those as "does not exist" would
 * hand the caller a confidently wrong diagnosis — worse than the vague one it
 * replaces — so only the two codes that actually mean "no such path" count,
 * and everything else is left for the real operation to fail on and report.
 */
export const isMissingPath = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
};
