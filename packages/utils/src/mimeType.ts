import mime from 'mime';

// Custom mime types for common code files not recognized by mime package
const CUSTOM_MIME_TYPES: Record<string, string> = {
  '.clj': 'text/x-clojure',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.go': 'text/x-go',
  '.hs': 'text/x-haskell',
  '.kt': 'text/x-kotlin',
  '.lua': 'text/x-lua',
  '.pl': 'text/x-perl',
  '.py': 'text/x-python',
  '.r': 'text/x-r',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.scala': 'text/x-scala',
  '.svelte': 'text/x-svelte',
  '.swift': 'text/x-swift',
  '.vue': 'text/x-vue',
};

/**
 * Get MIME type for a file path with fallback for code files
 * @param path - File path or filename
 * @returns MIME type string
 */
export const getMimeType = (path: string): string => {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return CUSTOM_MIME_TYPES[ext] || mime.getType(path) || 'application/octet-stream';
};
