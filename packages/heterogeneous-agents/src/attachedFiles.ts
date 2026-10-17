/**
 * Non-image attachment reference carried to a dispatched CLI. Pure and
 * isomorphic: the web app builds the same block for local desktop runs. The URL must be
 * fetchable from the machine the CLI runs on (e.g. a signed S3 URL).
 */
export interface HeteroAttachedFileRef {
  /** MIME type, shown so the agent can pick a parser before downloading. */
  fileType?: string;
  name: string;
  /** Size in bytes. */
  size?: number;
  url: string;
}

const formatSize = (size?: number) => {
  if (!size || size <= 0) return;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

// A file name is user input: keep it on one line so it cannot break out of its
// list item and read as instructions.
const singleLine = (value: string) => value.replaceAll(/\s+/g, ' ').trim();

/**
 * Describe the turn's non-image attachments so a CLI agent can fetch them.
 *
 * Images travel as content blocks; every other file type has no block the CLIs
 * accept, so without this the agent never learns the file exists. The files are
 * NOT on the agent's disk — the block says so and hands over the download URL.
 */
export const buildAttachedFilesPrompt = (files: HeteroAttachedFileRef[] = []) => {
  const usable = files.filter((file) => file.url);
  if (usable.length === 0) return;

  const lines = usable.map((file) => {
    const details = [file.fileType, formatSize(file.size)].filter(Boolean).join(', ');
    const name = singleLine(file.name) || 'file';

    return `- ${name}${details ? ` (${details})` : ''}: ${file.url}`;
  });

  return [
    '<attached_files>',
    'The user attached these files to this message. They are not on disk: download the ones you need (e.g. `curl -fsSL -o <name> "<url>"`) before reading them. The links are temporary, so download now rather than later.',
    ...lines,
    '</attached_files>',
  ].join('\n');
};

/**
 * Append the attached-files block to the user's prompt text.
 *
 * It rides inside the prompt, not as its own wire field, on purpose: the prompt
 * is the one field every already-installed `lh` forwards to the agent, so the
 * files reach it without the device having to upgrade first.
 */
export const appendAttachedFilesToPrompt = (prompt: string, files?: HeteroAttachedFileRef[]) => {
  const block = buildAttachedFilesPrompt(files);
  if (!block) return prompt;

  return prompt.trim() ? `${prompt}\n\n${block}` : block;
};

interface AttachedDocumentLike {
  fileType?: string;
  name: string;
  size?: number;
  url: string;
}

interface AttachedMediaLike {
  alt: string;
  mimeType?: string;
  url: string;
}

/**
 * Collect every attachment of a user message that is not an image, in the
 * shape the message lists already carry (`fileList` / `videoList` /
 * `audioList`). Images are excluded: they reach the CLI as image blocks.
 */
export const collectHeteroAttachedFiles = (lists: {
  audioList?: AttachedMediaLike[];
  fileList?: AttachedDocumentLike[];
  videoList?: AttachedMediaLike[];
}): HeteroAttachedFileRef[] => [
  ...(lists.fileList ?? []).map(({ fileType, name, size, url }) => ({ fileType, name, size, url })),
  ...(lists.videoList ?? []).map(({ alt, url }) => ({ name: alt, url })),
  ...(lists.audioList ?? []).map(({ alt, mimeType, url }) => ({
    fileType: mimeType,
    name: alt,
    url,
  })),
];
