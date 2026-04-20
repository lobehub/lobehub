import { readFile } from 'node:fs/promises';

import type { Plugin } from 'vite';

const MARKDOWN_IMPORT_QUERY = 'lobe-md-import';

function hasQuery(id: string) {
  return id.includes('?');
}

function isMarkdownFile(id: string) {
  return id.replace(/[?#].*$/, '').endsWith('.md');
}

function matchesMarkdownImportQuery(id: string) {
  const query = id.split('?')[1];
  if (!query) return false;

  const params = new URLSearchParams(query);

  return params.has(MARKDOWN_IMPORT_QUERY);
}

function withMarkdownImportQuery(id: string) {
  return `${id}${hasQuery(id) ? '&' : '?'}${MARKDOWN_IMPORT_QUERY}`;
}

export function viteMarkdownImport(): Plugin {
  return {
    enforce: 'pre',
    async load(id) {
      if (!matchesMarkdownImportQuery(id)) return null;

      const filePath = id.replace(/[?#].*$/, '');
      const content = await readFile(filePath, 'utf8');

      return `export default ${JSON.stringify(content)};`;
    },
    name: 'vite-markdown-import',
    async resolveId(source, importer, options) {
      if (!importer || hasQuery(source) || !isMarkdownFile(source)) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;

      return {
        id: withMarkdownImportQuery(resolved.id),
        moduleSideEffects: false,
      };
    },
  };
}
