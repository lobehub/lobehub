import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Only paths, never the command line or environment (both can contain credentials). */
async function resolveEntry(entry?: string): Promise<string | undefined> {
  if (!entry || !path.isAbsolute(entry) || /[\r\n\0]/.test(entry)) return undefined;
  try {
    return await realpath(entry);
  } catch {
    return entry;
  }
}

export function getCliInstallationPath() {
  return resolveEntry(process.argv[1] ? path.resolve(process.argv[1]) : undefined);
}

/** Legacy connectors did not report their entry path. Inspect only a known Node/Bun argv shape. */
export async function getConnectorInstallationPath(pid: number, reportedPath?: string) {
  if (reportedPath) return resolveEntry(reportedPath);
  if (process.platform !== 'linux') return undefined;
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    if (!/^(?:node|nodejs|bun)$/.test(path.basename(argv[0]))) return undefined;
    if (argv[2] !== 'connect' || !/\.(?:[cm]?js|ts)$/.test(argv[1])) return undefined;
    return resolveEntry(argv[1]);
  } catch {
    // A process may have exited or belong to a different user. Never print proc contents/errors.
    return undefined;
  }
}
