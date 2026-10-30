/**
 * How the share page presents a file. Media gets a stage of its own, archives
 * a download card; everything else goes through the reader (`FileViewer`),
 * which picks a renderer for PDFs, Office files, Markdown, HTML and text.
 */
export type SharedFileKind = 'archive' | 'audio' | 'document' | 'image' | 'video';

const EXTENSIONS: Record<Exclude<SharedFileKind, 'document'>, string[]> = {
  archive: ['7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip'],
  audio: ['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav'],
  image: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
  video: ['m4v', 'mov', 'mp4', 'webm'],
};

const ARCHIVE_MIME_TYPES = new Set([
  'application/gzip',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-gzip',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/x-xz',
  'application/x-zip-compressed',
  'application/zip',
]);

export const getSharedFileKind = ({
  fileType,
  name,
}: {
  fileType?: string | null;
  name: string;
}): SharedFileKind => {
  const mime = fileType?.toLowerCase() ?? '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (ARCHIVE_MIME_TYPES.has(mime)) return 'archive';

  const ext = name.toLowerCase().split('.').pop() ?? '';
  for (const kind of ['video', 'audio', 'image', 'archive'] as const) {
    if (EXTENSIONS[kind].includes(ext)) return kind;
  }

  return 'document';
};
