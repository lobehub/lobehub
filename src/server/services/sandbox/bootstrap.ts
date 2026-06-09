import {
  SANDBOX_UPLOADED_FILES_DIR,
  sandboxUploadedFilePath,
} from '@lobechat/builtin-tool-cloud-sandbox';

/** Marker file written once the uploaded files have been synced for a session. */
export const SANDBOX_FILES_INIT_MARKER = `${SANDBOX_UPLOADED_FILES_DIR}/.lobe-files-initialized`;

/** Timeout (ms) for the bootstrap download command. */
export const SANDBOX_INIT_TIMEOUT_MS = 120_000;

export interface SandboxInitDownload {
  name: string;
  /** A download URL (e.g. presigned) the sandbox can fetch with curl. */
  url: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Build an idempotent shell command that downloads the given uploaded files into
 * the sandbox upload directory. A marker file guards re-runs, so the command is
 * a cheap no-op once the files have been synced for the current session.
 *
 * Downloads are best-effort: a single failed fetch does not abort the rest, and
 * the marker is always written so the sync is not retried on every tool call.
 */
export const buildSandboxFilesInitCommand = (downloads: SandboxInitDownload[]): string => {
  const dir = shellQuote(SANDBOX_UPLOADED_FILES_DIR);
  const marker = shellQuote(SANDBOX_FILES_INIT_MARKER);

  const seen = new Set<string>();
  const curls: string[] = [];

  for (const { name, url } of downloads) {
    if (!url) continue;
    const path = sandboxUploadedFilePath(name);
    if (seen.has(path)) continue;
    seen.add(path);
    curls.push(`curl -fsSL ${shellQuote(url)} -o ${shellQuote(path)} || true`);
  }

  if (curls.length === 0) return `mkdir -p ${dir}`;

  const body = [...curls, `touch ${marker}`].join('; ');

  return `mkdir -p ${dir}; if [ ! -f ${marker} ]; then ${body}; fi`;
};
