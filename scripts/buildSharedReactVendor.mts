import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(root, 'dist/vendor-shared');
const entriesDir = path.resolve(root, 'dist/.vendor-shared-entries');

const SPECIFIERS: Record<string, string> = {
  'react': 'react',
  'react-dom': 'react-dom',
  'react-dom-client': 'react-dom/client',
  'react-jsx-runtime': 'react/jsx-runtime',
};

const IDENTIFIER_RE = /^[A-Z_$][\w$]*$/i;

// CJS packages (react, react-dom) only surface a default export through the
// bundler's interop, so each entry re-exports every runtime key explicitly to
// give consumers real ESM named exports
const writeEntry = async (name: string, specifier: string) => {
  const ns = await import(specifier);
  const named = Object.keys(ns).filter((key) => key !== 'default' && IDENTIFIER_RE.test(key));
  const lines = [
    `import * as __ns from '${specifier}';`,
    ...named.map((key) => `export const ${key} = __ns.${key};`),
  ];
  if ('default' in ns) lines.push('export default __ns.default;');

  const file = path.resolve(entriesDir, `${name}.js`);
  writeFileSync(file, lines.join('\n'));
  return file;
};

rmSync(entriesDir, { force: true, recursive: true });
mkdirSync(entriesDir, { recursive: true });

const entry: Record<string, string> = {};
for (const [name, specifier] of Object.entries(SPECIFIERS)) {
  entry[name] = await writeEntry(name, specifier);
}

const result = await build({
  build: {
    emptyOutDir: true,
    lib: { entry, formats: ['es'] },
    minify: true,
    outDir,
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        chunkFileNames: 'chunk-[hash].js',
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
  configFile: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'info',
  publicDir: false,
});

const outputs = Array.isArray(result) ? result : [result];
const chunks = outputs
  .flatMap((output) => ('output' in output ? output.output : []))
  .filter((item) => item.type === 'chunk');

const specifiers: Record<string, string> = {};
for (const chunk of chunks) {
  if (!chunk.isEntry) continue;
  const specifier = SPECIFIERS[chunk.name];
  if (!specifier) throw new Error(`Unexpected vendor entry chunk: ${chunk.name}`);
  specifiers[specifier] = chunk.fileName;
}

const missing = Object.values(SPECIFIERS).filter((specifier) => !specifiers[specifier]);
if (missing.length > 0) throw new Error(`Missing vendor entries: ${missing.join(', ')}`);

const manifest = {
  files: chunks.map((chunk) => chunk.fileName).sort(),
  specifiers,
};

writeFileSync(path.resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
rmSync(entriesDir, { force: true, recursive: true });
console.log(`Built shared react vendor (${manifest.files.length} files) -> dist/vendor-shared`);
