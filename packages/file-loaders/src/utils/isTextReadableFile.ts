export const TEXT_READABLE_FILE_TYPES = [
  // Plain Text & Markup
  'txt',
  'md',
  'markdown',
  'mdx',

  // Configuration & Data
  'json',
  'jsonc',
  'json5',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'csv',
  'env',
  'properties',

  // Web Development
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'vue',
  'svelte',
  'svg',

  // Scripting & Programming
  'php',
  'py',
  'rb',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'swift',
  'kt',
  'sh',
  'bash',
  'bat',
  'ps1',
  'lua',
  'dart',
  'scala',
  'groovy',
  'gradle',

  // Other
  'log',
  'sql',
  'patch',
  'diff',
  'db', // Often text-based, like SQLite journals
];

/**
 * Extensions that have dedicated parsers in `loadFile`. These are not text but
 * are explicitly supported file types that we know how to extract text from.
 */
export const SPECIAL_PARSED_FILE_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx'];

/**
 * Determine if a file can be read as text based on its extension.
 * @param fileType File extension (without the leading dot)
 * @returns Whether the file is likely text-readable
 */
export function isTextReadableFile(fileType: string): boolean {
  return TEXT_READABLE_FILE_TYPES.includes(fileType.toLowerCase());
}

/**
 * Whether the agent's `readFile` should be willing to attempt reading this
 * extension at all. True for known text formats and for the special parsed
 * binary formats (pdf/doc/etc.) that have dedicated loaders. Anything else —
 * `.bin`, `.zip`, `.b64`, `.exe`, … — should be hard-rejected before the file
 * is opened, to avoid feeding a binary blob to the LLM.
 */
export function isReadableFileType(fileType: string): boolean {
  const ext = fileType.toLowerCase();
  return TEXT_READABLE_FILE_TYPES.includes(ext) || SPECIAL_PARSED_FILE_TYPES.includes(ext);
}
