import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { Plugin, PluginOption } from 'vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import {
  sharedRendererDefine,
  sharedRendererPlugins,
} from '../../plugins/vite/sharedRendererConfig';
import { isShikiSource } from './app/stubs/shikiSource';
import { reportStubSurfaceGaps } from './app/stubs/surface';

/**
 * The offline acceptance report: one self-contained HTML file the CLI fills
 * with a local acceptance (`lh acceptance run render`). Opened from disk, a
 * page may not load module scripts or fetch siblings, so every script, style
 * and font is inlined and nothing is loaded at runtime — no CDN, no API.
 *
 * Output: dist-report/acceptance-report.html, copied into the CLI package.
 */

const repoRoot = path.resolve(import.meta.dirname, '../..');
const stubDir = path.resolve(import.meta.dirname, 'src/localReport/stubs');
const appStubDir = path.resolve(import.meta.dirname, 'app/stubs');
// Use the exact KaTeX installed for the Markdown renderer, not a CDN version.
const uiRequire = createRequire(createRequire(import.meta.url).resolve('@lobehub/ui'));

const stubs: Record<string, string> = {
  '@/libs/trpc/client': path.resolve(appStubDir, 'trpcClient.ts'),
  '@/services/acceptanceComment': path.resolve(stubDir, 'acceptanceCommentService.ts'),
  '@/services/global': path.resolve(appStubDir, 'globalService.ts'),
  '@/services/verify': path.resolve(stubDir, 'verifyService.ts'),
  '@/store/electron': path.resolve(appStubDir, 'electronStore.ts'),
  '@/store/file': path.resolve(appStubDir, 'fileStore.ts'),
  '@/store/user': path.resolve(stubDir, 'userStore.ts'),
  '@/store/verify': path.resolve(stubDir, 'verifyStore.ts'),
  '@/utils/i18n/loadI18nNamespaceModule': path.resolve(stubDir, 'loadI18nNamespaceModule.ts'),
};
const shikiStub = path.resolve(appStubDir, 'shiki.ts');

/** GitHub alert icons in Markdown: five glyphs out of a 1 MB icon set. */
const OCTICONS = '\0acceptance-report:octicons';
const ALERT_ICONS = ['alert', 'info', 'light-bulb', 'report', 'stop'];

/** The reaction picker's emoji set: comments are a shared-acceptance feature. */
const EMOJI_DATA = '\0acceptance-report:emoji-data';

/** Only this host replaces Markdown's remote media with explicit links. */
const LOCAL_MARKDOWN = '\0acceptance-report:markdown';
const localMarkdown = path.resolve(import.meta.dirname, 'src/localReport/LocalMarkdown.tsx');

const localReportStubs = (): Plugin => ({
  enforce: 'pre',
  load(id) {
    if (id === LOCAL_MARKDOWN)
      return `export { LocalMarkdown as default } from ${JSON.stringify(localMarkdown)};`;
    if (id === EMOJI_DATA)
      return 'export default { aliases: {}, categories: [], emojis: {}, natives: {}, sheet: { cols: 0, rows: 0 } };';
    if (!id.startsWith(OCTICONS)) return;
    const entry = id.slice(OCTICONS.length + 1);
    const data = JSON.parse(
      readFileSync(path.resolve(path.dirname(entry), 'build/data.json'), 'utf8'),
    ) as Record<string, { heights: Record<string, { path: string }> }>;
    const icons = Object.fromEntries(
      ALERT_ICONS.map((name) => [
        name,
        { heights: { 16: { path: data[name]!.heights[16]!.path } } },
      ]),
    );
    return `export default ${JSON.stringify(icons)};`;
  },
  name: 'acceptance-report-stubs',
  async resolveId(source, importer, options) {
    if (stubs[source]) return stubs[source];
    if (source === 'katex/dist/katex.min.css') return uiRequire.resolve(source);
    // lobeUiImports resolves the root barrel's Markdown export to this entry.
    // The wrapper itself must still reach the original component.
    if (source === '@lobehub/ui/es/Markdown/Markdown' && importer !== localMarkdown)
      return LOCAL_MARKDOWN;
    if (source === '@emoji-mart/data') return EMOJI_DATA;
    if (source === '@primer/octicons') {
      const real = await this.resolve(source, importer, { ...options, skipSelf: true });
      return real && `${OCTICONS}?${real.id}`;
    }
    // Grammars, themes and the wasm engine are megabytes; code renders plain.
    if (isShikiSource(source, importer)) return shikiStub;
  },
});

/** Fail the build when the page graph uses a stub member the stub does not implement. */
const stubSurfaceGuard = (): Plugin => ({
  apply: 'build',
  buildEnd() {
    if (!this.getModuleInfo(localMarkdown))
      this.error('The local report must use LocalMarkdown to keep external media offline.');
    const stubEntries = Object.entries(stubs).map(([specifier, file]) => ({
      source: readFileSync(file, 'utf8'),
      specifier,
    }));
    const files: Array<{ rel: string; source: string }> = [];
    for (const id of this.getModuleIds()) {
      if (!id.startsWith(repoRoot) || id.includes('/node_modules/') || id.includes('\0')) continue;
      const file = id.split('?')[0]!;
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const rel = path.relative(repoRoot, file);
      if (
        rel.startsWith('apps/workbench/app/stubs/') ||
        rel.startsWith('apps/workbench/src/localReport/stubs/')
      )
        continue;
      try {
        files.push({ rel, source: readFileSync(file, 'utf8') });
      } catch {
        continue;
      }
    }
    const lines = reportStubSurfaceGaps(files, stubEntries);
    if (lines.length > 0) {
      this.error(
        `Local report stub is missing APIs used by the module graph:\n${lines.join('\n')}\n` +
          `Add the member to the matching stub, or keep the importer off the report graph.`,
      );
    }
  },
  name: 'acceptance-report-stub-surface-guard',
});

/** `REPORT_TRACE_MODULE=<path fragment>` prints who pulls a module into the report. */
const moduleTrace = (needle: string): Plugin => ({
  buildEnd() {
    for (const target of [...this.getModuleIds()].filter((id) => id.includes(needle)).slice(0, 2)) {
      const parent = new Map<string, string | null>([[target, null]]);
      const queue = [target];
      let found: string | null = null;
      while (queue.length > 0 && !found) {
        const current = queue.shift()!;
        const info = this.getModuleInfo(current);
        for (const importer of [...(info?.importers ?? []), ...(info?.dynamicImporters ?? [])]) {
          if (parent.has(importer)) continue;
          parent.set(importer, current);
          queue.push(importer);
          if (importer.includes('src/localReport/entry')) {
            found = importer;
            break;
          }
        }
      }
      const chain: string[] = [];
      for (let cursor = found; cursor; cursor = parent.get(cursor) ?? null) chain.push(cursor);
      console.info(
        `\n=== module trace: ${target}\n${chain.join('\n -> ') || '(no importer path)'}`,
      );
    }
  },
  name: 'acceptance-report-module-trace',
});

/** `</script` or `<!--` inside an inline script would end or confuse the element. */
const escapeInlineScript = (code: string) =>
  code.replaceAll('</script', String.raw`<\/script`).replaceAll('<!--', String.raw`<\!--`);

/**
 * Inline every script and stylesheet into the HTML, leaving one file. Runs once
 * the whole bundle is on disk, so CSS appended by later `generateBundle` hooks
 * (StyleX) is included too.
 */
const singleFile = (outDir: string): Plugin => {
  let written = false;
  return {
    apply: 'build',
    closeBundle() {
      // Do not mask a compilation error with a missing-output error.
      if (!written) return;
      const htmlPath = path.join(outDir, 'report.html');
      let html = readFileSync(htmlPath, 'utf8');
      const inlined = new Set<string>([htmlPath]);
      const read = (url: string) => {
        const file = path.resolve(outDir, url);
        inlined.add(file);
        return readFileSync(file, 'utf8');
      };

      html = html.replaceAll(
        /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
        (_tag, url: string) => `<script type="module">${escapeInlineScript(read(url))}</script>`,
      );
      html = html.replaceAll(
        /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
        (_tag, url: string) => `<style>${read(url)}</style>`,
      );
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name));
      const unlinkedCss = files.filter((file) => file.endsWith('.css') && !inlined.has(file));
      if (unlinkedCss.length > 0) {
        const css = unlinkedCss.map((file) => read(path.relative(outDir, file))).join('\n');
        html = html.replace('</head>', () => `<style>${css}</style></head>`);
      }

      const leftovers = files.filter((file) => !inlined.has(file));
      if (leftovers.length > 0)
        throw new Error(
          `The report must be one file; not inlined: ${leftovers.map((file) => path.relative(outDir, file)).join(', ')}`,
        );
      for (const file of inlined) rmSync(file);
      for (const entry of readdirSync(outDir))
        rmSync(path.join(outDir, entry), { recursive: true });
      writeFileSync(path.join(outDir, 'acceptance-report.html'), html);
    },
    name: 'acceptance-report-single-file',
    writeBundle() {
      written = true;
    },
  };
};

/** Shared renderer plugins that emit files a report page never loads. */
const UNUSED_PLUGINS = new Set(['lobe-canvas-runtime', 'lobe-completion-sounds']);

const outDir = path.resolve(import.meta.dirname, 'dist-report');

/** `REPORT_ANALYZE=1` prints the heaviest packages in the report. */
const analyze = (): Plugin => ({
  generateBundle(_options, bundle) {
    const sizes = new Map<string, number>();
    for (const item of Object.values(bundle)) {
      if (item.type !== 'chunk') continue;
      for (const [id, info] of Object.entries(item.modules)) {
        const rel = path.relative(repoRoot, id);
        const pkg = rel.includes('node_modules/')
          ? rel
              .split('node_modules/')
              .at(-1)!
              .split('/')
              .slice(0, rel.split('node_modules/').at(-1)!.startsWith('@') ? 2 : 1)
              .join('/')
          : rel.split('/').slice(0, 3).join('/');
        sizes.set(pkg, (sizes.get(pkg) ?? 0) + info.renderedLength);
      }
    }
    const top = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.info(
      top.map(([name, size]) => `${(size / 1024).toFixed(0).padStart(7)} KB  ${name}`).join('\n'),
    );
  },
  name: 'acceptance-report-analyze',
});

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    emptyOutDir: true,
    modulePreload: false,
    outDir,
    reportCompressedSize: false,
    rolldownOptions: {
      input: path.resolve(import.meta.dirname, 'report.html'),
      output: { codeSplitting: false },
    },
  },
  define: {
    ...sharedRendererDefine({ isElectron: false, isMobile: true }),
    __WORKBENCH__: 'true',
  },
  plugins: [
    // Before path aliases: a stub replaces the module `@/…` would resolve to.
    localReportStubs(),
    tsconfigPaths({
      ignoreConfigErrors: true,
      projects: [path.resolve(repoRoot, 'tsconfig.json')],
      root: repoRoot,
    }),
    process.env.REPORT_TRACE_MODULE ? moduleTrace(process.env.REPORT_TRACE_MODULE) : undefined,
    process.env.REPORT_ANALYZE ? analyze() : undefined,
    stubSurfaceGuard(),
    ...sharedRendererPlugins({ platform: 'mobile' }).filter(
      (plugin) => !(plugin && 'name' in plugin && UNUSED_PLUGINS.has(plugin.name)),
    ),
    singleFile(outDir),
  ].filter(Boolean) as PluginOption[],
  // Nothing is served next to the file.
  publicDir: false,
  resolve: {
    // One copy of every module-level singleton: a second dayjs, reached through
    // a workspace package's own install, keeps its locale apart from the page's.
    dedupe: ['@lobehub/editor', '@lobehub/ui', 'dayjs', 'react', 'react-dom'],
  },
  root: import.meta.dirname,
});
