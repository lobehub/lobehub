/**
 * Directory inside the cloud sandbox where user-uploaded files (attached to the
 * conversation topic / session) are synced when the sandbox session starts.
 */
export const SANDBOX_UPLOADED_FILES_DIR = '/mnt/data';

/** Skip individual files larger than this when syncing into the sandbox. */
export const SANDBOX_INIT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Hard cap on how many uploaded files are synced into the sandbox. */
export const SANDBOX_INIT_MAX_FILES = 50;

export interface SandboxUploadedFileMeta {
  name: string;
  size?: number;
}

/**
 * Select the files that the sandbox bootstrap will actually sync, applying the
 * per-file size cap and the total count cap. Shared by the bootstrap (what gets
 * downloaded) and the prompt (what the agent is told exists) so the two never
 * drift apart. Items with an unknown size are kept (we cannot rule them out).
 */
export const selectSandboxInitFiles = <T extends { size?: number }>(files: T[]): T[] =>
  files
    .filter((file) => file.size == null || file.size <= SANDBOX_INIT_MAX_FILE_SIZE)
    .slice(0, SANDBOX_INIT_MAX_FILES);

const formatBytes = (size?: number): string => {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return ` (${rounded}${units[unit]})`;
};

/**
 * Reduce an uploaded file name to a safe, flat basename so it cannot escape the
 * sandbox upload directory (no path traversal) or carry control characters.
 */
export const sanitizeSandboxFileName = (name: string): string => {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned : 'file';
};

/**
 * Build the absolute sandbox path for an uploaded file.
 */
export const sandboxUploadedFilePath = (name: string): string =>
  `${SANDBOX_UPLOADED_FILES_DIR}/${sanitizeSandboxFileName(name)}`;

/**
 * Render the whole `<uploaded_files>` section, or nothing at all.
 *
 * The section used to be static in the prompt with only the file list filled
 * in, so a conversation with no attachments still read "run `listFiles` on
 * /mnt/data" — and that directory is only created while syncing files, so the
 * agent spent a tool call on `Directory not found` and then had to reason its
 * way out of a failure that was never real. Nothing is uploaded in most
 * conversations, so the instruction belongs with the files it describes.
 *
 * Applies the same size/count caps as the bootstrap and de-dupes by resolved
 * sandbox path, so the listed files match exactly what is written to disk.
 */
export const formatUploadedFilesPrompt = (files: SandboxUploadedFileMeta[]): string => {
  if (!files || files.length === 0) return '';

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const file of selectSandboxInitFiles(files)) {
    if (!file?.name) continue;
    const path = sandboxUploadedFilePath(file.name);
    if (seen.has(path)) continue;
    seen.add(path);
    lines.push(`- ${path}${formatBytes(file.size)}`);
  }

  if (lines.length === 0) return '';

  return [
    '<uploaded_files>',
    `Files the user uploaded in this conversation (attachments and session files) are automatically synced into \`${SANDBOX_UPLOADED_FILES_DIR}\` when your sandbox session starts. If the user refers to a file they shared, look there first — do NOT ask them to re-upload. Run \`listFiles\` on \`${SANDBOX_UPLOADED_FILES_DIR}\` to see everything that is available.`,
    'These user-uploaded files are pre-loaded and ready to use:',
    ...lines,
    '</uploaded_files>',
  ].join('\n');
};
