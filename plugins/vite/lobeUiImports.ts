import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import transformImports from '@rolldown/plugin-transform-imports';
import type { Plugin, PluginOption } from 'vite';

const NAMED_EXPORT_PREFIX = 'virtual:lobe-ui-named:';
const RESOLVED_NAMED_EXPORT_PREFIX = `\0${NAMED_EXPORT_PREFIX}`;

const BARRELS = ['', 'awesome', 'base-ui', 'brand', 'chat', 'color', 'icons', 'mdx'] as const;

interface MemberSource {
  imported: string;
  source: string;
}

type BarrelMap = Record<string, MemberSource>;

const toSubpath = (barrelDir: string, specifier: string) => {
  if (!specifier.startsWith('.')) return specifier;
  const relative = path.posix.join(barrelDir, specifier).replace(/\.mjs$/, '');
  return `@lobehub/ui/es/${relative}`;
};

export const parseBarrel = (code: string, barrelDir: string): BarrelMap => {
  const locals: BarrelMap = {};
  for (const match of code.matchAll(/^import\s(.+?)\sfrom\s"([^"]+)";?$/gm)) {
    const [, clause, specifier] = match;
    const source = toSubpath(barrelDir, specifier);
    const brace = clause.indexOf('{');
    const defaultLocal = (brace === -1 ? clause : clause.slice(0, brace)).replace(',', '').trim();
    if (defaultLocal) locals[defaultLocal] = { imported: 'default', source };
    const named = brace === -1 ? '' : clause.slice(brace + 1, clause.indexOf('}'));
    for (const part of named.split(',')) {
      const [imported, local = imported] = part.trim().split(/\sas\s/);
      if (imported) locals[local] = { imported, source };
    }
  }

  const members: BarrelMap = {};
  for (const match of code.matchAll(/^export\s*\{([^}]*)\};?$/gm)) {
    for (const part of match[1].split(',')) {
      const [local, exported = local] = part.trim().split(/\sas\s/);
      if (local && locals[local]) members[exported] = locals[local];
    }
  }
  return members;
};

const loadBarrelMaps = () => {
  const esRoot = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../node_modules/@lobehub/ui/es',
  );
  const maps: Record<string, BarrelMap> = {};
  for (const barrel of BARRELS) {
    const barrelDir = barrel ? `${barrel}/` : '';
    const code = readFileSync(path.join(esRoot, barrelDir, 'index.mjs'), 'utf8');
    maps[barrel] = parseBarrel(code, barrelDir);
  }
  return maps;
};

const namedExportProxy = (maps: Record<string, BarrelMap>): Plugin => ({
  name: 'lobe-ui-named-export-proxy',
  load(id) {
    if (!id.startsWith(RESOLVED_NAMED_EXPORT_PREFIX)) return;

    const [barrel, member] = id.slice(RESOLVED_NAMED_EXPORT_PREFIX.length).split(':');
    const entry = maps[barrel]?.[member];
    if (!entry)
      return `export { ${member} as default } from '@lobehub/ui/es/${barrel ? `${barrel}/` : ''}index';`;

    return `export { ${entry.imported} as default } from '${entry.source}';`;
  },
  resolveId(id) {
    if (!id.startsWith(NAMED_EXPORT_PREFIX)) return;

    return `\0${id}`;
  },
});

const includeModuleExtensions = (plugin: ReturnType<typeof transformImports>) => {
  if (typeof plugin.transform !== 'object' || !plugin.transform) return plugin;

  plugin.transform = {
    ...plugin.transform,
    filter: {
      ...plugin.transform.filter,
      id: /\.[cm]?[jt]sx?$/,
    },
  };

  return plugin;
};

/**
 * Rewrites the @lobehub/ui barrels to deep imports.
 *
 * Rolldown assigns chunks by static reachability, and the barrel keeps static
 * edges to every member. Once any lazy route uses Markdown, Mermaid or
 * EmojiPicker, their full dependency trees (shiki, katex, elkjs, emoji data)
 * are promoted into the first-screen chunk even though the entry only touches
 * ConfigProvider and Flexbox. The member→module map is read from the barrel
 * files themselves so it tracks upstream releases.
 */
export const lobeUiImports = (): PluginOption[] => {
  const maps = loadBarrelMaps();
  const uiImports = transformImports(
    Object.fromEntries(
      BARRELS.map((barrel) => [
        barrel ? `@lobehub/ui/${barrel}` : '@lobehub/ui',
        { transform: [['*', `${NAMED_EXPORT_PREFIX}${barrel}:{{member}}`]] },
      ]),
    ),
  );

  return [namedExportProxy(maps), includeModuleExtensions(uiImports)];
};

export const __testing = { NAMED_EXPORT_PREFIX, RESOLVED_NAMED_EXPORT_PREFIX };
