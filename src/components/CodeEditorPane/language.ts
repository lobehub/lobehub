/**
 * Grammar ids the bundled CodeMirror build actually ships, read off its own
 * language registry. A mode outside this set is silently dropped and the file
 * renders as unhighlighted plain text, so every value produced below must be
 * one of these; a language with no grammar borrows the closest one rather than
 * inventing an id.
 */
const SUPPORTED_MODES = new Set([
  'abap',
  'agda',
  'arkts',
  'basic',
  'c',
  'clojure',
  'cmake',
  'commonlisp',
  'cpp',
  'csharp',
  'css',
  'cypher',
  'dart',
  'diff',
  'dockerfile',
  'erlang',
  'fortran',
  'glsl',
  'go',
  'graphql',
  'groovy',
  'haskell',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'julia',
  'kotlin',
  'lua',
  'makefile',
  'nginx',
  'objectivec',
  'ocaml',
  'pascal',
  'perl',
  'php',
  'plantuml',
  'plsql',
  'powershell',
  'properties',
  'protobuf',
  'python',
  'r',
  'ruby',
  'rust',
  'sass',
  'scala',
  'scheme',
  'shell',
  'solidity',
  'sql',
  'stex',
  'swift',
  'tcl',
  'toml',
  'tsx',
  'typescript',
  'vbnet',
  'velocity',
  'verilog',
  'vue',
  'xml',
  'yaml',
  'z80',
]);

export interface EditorLanguage {
  /**
   * Human-readable name for the status bar. Kept apart from `mode` so a
   * language that borrows another's grammar still reports its own name.
   */
  label: string;
  /** CodeMirror grammar id, or an empty string to render as plain text. */
  mode: string;
}

const plain = (label: string): EditorLanguage => ({ label, mode: '' });

const lang = (label: string, mode: string): EditorLanguage => ({ label, mode });

/** Matched against the whole lowercased filename before any extension lookup. */
const FILENAME_LANGUAGES: Record<string, EditorLanguage> = {
  '.bash_profile': lang('Shell', 'shell'),
  '.bashrc': lang('Shell', 'shell'),
  '.dockerignore': lang('Ignore', 'properties'),
  '.env': lang('Dotenv', 'properties'),
  '.editorconfig': lang('EditorConfig', 'properties'),
  '.gitattributes': lang('Git Attributes', 'properties'),
  '.gitignore': lang('Ignore', 'properties'),
  '.npmrc': lang('npmrc', 'properties'),
  '.profile': lang('Shell', 'shell'),
  '.zshrc': lang('Shell', 'shell'),
  'cmakelists.txt': lang('CMake', 'cmake'),
  'containerfile': lang('Dockerfile', 'dockerfile'),
  'dockerfile': lang('Dockerfile', 'dockerfile'),
  'gnumakefile': lang('Makefile', 'makefile'),
  'makefile': lang('Makefile', 'makefile'),
  'nginx.conf': lang('Nginx', 'nginx'),
};

const EXTENSION_LANGUAGES: Record<string, EditorLanguage> = {
  bash: lang('Shell', 'shell'),
  c: lang('C', 'c'),
  cc: lang('C++', 'cpp'),
  cfg: lang('Config', 'properties'),
  cjs: lang('JavaScript', 'javascript'),
  cmake: lang('CMake', 'cmake'),
  conf: lang('Config', 'properties'),
  cpp: lang('C++', 'cpp'),
  cs: lang('C#', 'csharp'),
  css: lang('CSS', 'css'),
  cts: lang('TypeScript', 'typescript'),
  cxx: lang('C++', 'cpp'),
  dart: lang('Dart', 'dart'),
  diff: lang('Diff', 'diff'),
  dockerfile: lang('Dockerfile', 'dockerfile'),
  env: lang('Dotenv', 'properties'),
  erl: lang('Erlang', 'erlang'),
  // ArkTS is TypeScript with decorators; the bundle ships a dedicated grammar.
  ets: lang('ArkTS', 'arkts'),
  fish: lang('Shell', 'shell'),
  frag: lang('GLSL', 'glsl'),
  glsl: lang('GLSL', 'glsl'),
  gql: lang('GraphQL', 'graphql'),
  gradle: lang('Gradle', 'groovy'),
  graphql: lang('GraphQL', 'graphql'),
  groovy: lang('Groovy', 'groovy'),
  h: lang('C', 'c'),
  hh: lang('C++', 'cpp'),
  hpp: lang('C++', 'cpp'),
  hrl: lang('Erlang', 'erlang'),
  clj: lang('Clojure', 'clojure'),
  cljc: lang('Clojure', 'clojure'),
  cljs: lang('Clojure', 'clojure'),
  hs: lang('Haskell', 'haskell'),
  htm: lang('HTML', 'html'),
  html: lang('HTML', 'html'),
  http: plain('HTTP'),
  hxx: lang('C++', 'cpp'),
  ini: lang('INI', 'properties'),
  java: lang('Java', 'java'),
  js: lang('JavaScript', 'javascript'),
  json: lang('JSON', 'json'),
  jl: lang('Julia', 'julia'),
  json5: lang('JSON5', 'json'),
  jsonc: lang('JSON', 'json'),
  jsx: lang('JSX', 'jsx'),
  kt: lang('Kotlin', 'kotlin'),
  kts: lang('Kotlin', 'kotlin'),
  ksh: lang('Shell', 'shell'),
  less: lang('Less', 'css'),
  lua: lang('Lua', 'lua'),
  markdown: plain('Markdown'),
  md: plain('Markdown'),
  mdx: plain('MDX'),
  mjs: lang('JavaScript', 'javascript'),
  mts: lang('TypeScript', 'typescript'),
  patch: lang('Diff', 'diff'),
  pas: lang('Pascal', 'pascal'),
  php: lang('PHP', 'php'),
  pl: lang('Perl', 'perl'),
  plist: lang('Property List', 'xml'),
  pm: lang('Perl', 'perl'),
  prisma: plain('Prisma'),
  properties: lang('Properties', 'properties'),
  proto: lang('Protocol Buffers', 'protobuf'),
  ps1: lang('PowerShell', 'powershell'),
  psm1: lang('PowerShell', 'powershell'),
  py: lang('Python', 'python'),
  pyi: lang('Python', 'python'),
  pyw: lang('Python', 'python'),
  r: lang('R', 'r'),
  rake: lang('Ruby', 'ruby'),
  rb: lang('Ruby', 'ruby'),
  rs: lang('Rust', 'rust'),
  sass: lang('Sass', 'sass'),
  scala: lang('Scala', 'scala'),
  scss: lang('SCSS', 'sass'),
  sh: lang('Shell', 'shell'),
  sol: lang('Solidity', 'solidity'),
  sql: lang('SQL', 'sql'),
  sv: lang('SystemVerilog', 'verilog'),
  svelte: lang('Svelte', 'html'),
  svg: lang('SVG', 'xml'),
  svh: lang('SystemVerilog', 'verilog'),
  swift: lang('Swift', 'swift'),
  tcl: lang('Tcl', 'tcl'),
  tex: lang('LaTeX', 'stex'),
  tf: plain('Terraform'),
  tfvars: plain('Terraform'),
  toml: lang('TOML', 'toml'),
  ts: lang('TypeScript', 'typescript'),
  tsx: lang('TSX', 'tsx'),
  txt: plain('Plain Text'),
  v: lang('Verilog', 'verilog'),
  vb: lang('Visual Basic', 'vbnet'),
  vh: lang('Verilog', 'verilog'),
  vert: lang('GLSL', 'glsl'),
  vue: lang('Vue', 'vue'),
  xml: lang('XML', 'xml'),
  xsl: lang('XSL', 'xml'),
  yaml: lang('YAML', 'yaml'),
  yml: lang('YAML', 'yaml'),
  zsh: lang('Shell', 'shell'),
};

const PLAIN_TEXT: EditorLanguage = plain('Plain Text');

/**
 * Resolve the editor grammar and status-bar label for a file. Accepts a bare
 * name or a full path, and falls back to plain text rather than guessing.
 */
export const getEditorLanguage = (filePath?: string | null): EditorLanguage => {
  if (!filePath) return PLAIN_TEXT;

  const name = (filePath.split(/[/\\]/).at(-1) ?? '').toLowerCase();
  if (!name) return PLAIN_TEXT;

  const byFilename = FILENAME_LANGUAGES[name];
  if (byFilename) return byFilename;

  const dotIndex = name.lastIndexOf('.');
  // A leading dot is part of the name (`.gitignore`), not an extension marker.
  if (dotIndex > 0) {
    const byExtension = EXTENSION_LANGUAGES[name.slice(dotIndex + 1)];
    if (byExtension) return byExtension;
  }

  // `.env.production` and `Dockerfile.dev` name their type first and qualify it
  // after, the opposite of `app.ts`. Only consulted once the trailing extension
  // has come up empty, so `Makefile.md` still reads as Markdown.
  const leadingSegment = name.split('.').find(Boolean);
  if (leadingSegment && name.includes('.')) {
    const byPrefix = FILENAME_LANGUAGES[leadingSegment] ?? FILENAME_LANGUAGES[`.${leadingSegment}`];
    if (byPrefix) return byPrefix;
  }

  return PLAIN_TEXT;
};

/** Guard against a mapping drifting away from the shipped grammar set. */
export const isSupportedEditorMode = (mode: string): boolean => SUPPORTED_MODES.has(mode);

/** Exported so a test can assert every mapping still points at a real grammar. */
export const FILENAME_LANGUAGES_FOR_TEST = FILENAME_LANGUAGES;
export const EXTENSION_LANGUAGES_FOR_TEST = EXTENSION_LANGUAGES;
