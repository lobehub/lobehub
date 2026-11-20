import posixPath from 'node:path/posix';

import {
  SANDBOX_UPLOADED_FILES_DIR,
  sandboxUploadedFilePath,
} from '@lobechat/builtin-tool-cloud-sandbox';

/**
 * Directory of per-file markers: `<dir>/<fileId>` exists once that file has
 * been synced into the sandbox for the current session. It sits next to the
 * upload directory rather than inside it, so no uploaded file name can collide
 * with it and listing the upload directory shows only the user's files.
 */
export const SANDBOX_FILES_MARKER_DIR = posixPath.join(
  posixPath.dirname(SANDBOX_UPLOADED_FILES_DIR),
  '.lobe-synced-files',
);

/** Timeout (ms) for the bootstrap download command. */
export const SANDBOX_INIT_TIMEOUT_MS = 120_000;

export interface SandboxInitDownload {
  /** File id; keys the marker, so a file attached later in the topic is still synced. */
  id: string;
  name: string;
  /** A download URL (e.g. presigned) the sandbox can fetch with curl. */
  url: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

/**
 * Build an idempotent shell command that downloads the given uploaded files into
 * the sandbox upload directory.
 *
 * Each file has its own marker, written only after its download succeeded, so
 * the command is a cheap no-op for files already synced in this session, while
 * a file attached after the session started — or one whose download failed —
 * is fetched by the next call. A single session-wide marker used to skip those
 * files for the rest of the session, although the prompt lists them as
 * pre-loaded.
 *
 * Downloads are best-effort: a failed fetch does not abort the rest.
 */
export const buildSandboxFilesInitCommand = (downloads: SandboxInitDownload[]): string => {
  const dir = shellQuote(SANDBOX_UPLOADED_FILES_DIR);

  const seen = new Set<string>();
  const steps: string[] = [];

  for (const { id, name, url } of downloads) {
    if (!url || !id) continue;
    const path = sandboxUploadedFilePath(name);
    if (seen.has(path)) continue;
    seen.add(path);

    const marker = shellQuote(`${SANDBOX_FILES_MARKER_DIR}/${id}`);
    steps.push(
      `if [ ! -f ${marker} ]; then curl -fsSL ${shellQuote(url)} -o ${shellQuote(path)} && touch ${marker} || true; fi`,
    );
  }

  if (steps.length === 0) return `mkdir -p ${dir}`;

  return [`mkdir -p ${dir} ${shellQuote(SANDBOX_FILES_MARKER_DIR)}`, ...steps].join('; ');
};
