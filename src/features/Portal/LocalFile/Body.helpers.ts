const EXT_TO_LANG: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dockerfile: 'dockerfile',
  fish: 'fish',
  go: 'go',
  graphql: 'graphql',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mdx: 'mdx',
  php: 'php',
  prisma: 'prisma',
  proto: 'protobuf',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  tf: 'hcl',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  txt: 'txt',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export const extensionToLanguage = (ext: string): string => {
  if (!ext) return 'txt';
  return EXT_TO_LANG[ext.toLowerCase()] ?? 'txt';
};

export const getFileExtension = (filename: string): string => {
  const base = filename.split('/').at(-1) ?? filename;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx < 0) return '';
  return base.slice(dotIdx + 1);
};
