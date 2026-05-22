import type { Plugin, ResolvedConfig } from 'vite';

interface RouteChunkPreloadRoute {
  includeDynamicImports?: boolean;
  id: string;
  includeStaticImports?: boolean;
  modules: string[];
  patterns: string[];
}

interface RuntimeRoutePreloadEntry {
  id: string;
  patterns: string[];
  preload: string[];
}

interface IdleWarmupManifest {
  allJsManifestFileName?: string;
  idleRoutePreload: string[];
}

interface OutputChunkLike {
  code: string;
  dynamicImports: string[];
  facadeModuleId: null | string;
  fileName: string;
  imports: string[];
  moduleIds: string[];
  type: 'chunk';
}

type OutputBundleLike = Record<string, OutputChunkLike | { type: string }>;

const defaultRoutePreloadGroups = [
  {
    id: 'desktop-chat-launch',
    modules: [
      'src/routes/(main)/_layout',
      'src/routes/(main)/agent/_layout',
      'src/routes/(main)/agent/(chat)/_layout',
      'src/routes/(main)/agent',
    ],
    patterns: ['^/agent(/|$)'],
  },
] as const satisfies RouteChunkPreloadRoute[];

const defaultIdleRoutePreloadGroups = [
  {
    id: 'desktop-agent-profile',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/agent/profile'],
    patterns: ['^/agent/[^/]+/profile(/|$)'],
  },
  {
    id: 'desktop-agent-channel',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/agent/channel'],
    patterns: ['^/agent/[^/]+/channel(/|$)'],
  },
  {
    id: 'desktop-agent-page',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/agent/page',
      'src/routes/(main)/agent/[topicId]/page',
      'src/routes/(main)/agent/[topicId]/page/[docId]',
    ],
    patterns: ['^/agent/[^/]+(?:/[^/]+)?/page(/|$)'],
  },
  {
    id: 'desktop-community',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/community/_layout',
      'src/routes/(main)/community/(list)/_layout',
      'src/routes/(main)/community/(detail)/_layout',
      'src/routes/(main)/community/(list)/(home)',
    ],
    patterns: ['^/community(/|$)'],
  },
  {
    id: 'desktop-resource',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/resource/_layout',
      'src/routes/(main)/resource/(home)/_layout',
      'src/routes/(main)/resource/(home)',
      'src/routes/(main)/resource/library/_layout',
      'src/routes/(main)/resource/library',
      'src/routes/(main)/resource/library/[slug]',
    ],
    patterns: ['^/resource(/|$)'],
  },
  {
    id: 'desktop-settings',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/settings/_layout', 'src/routes/(main)/settings'],
    patterns: ['^/settings(/|$)'],
  },
  {
    id: 'desktop-settings-provider',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/settings/provider'],
    patterns: ['^/settings/provider(/|$)'],
  },
  {
    id: 'desktop-tasks',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/(task-workspace)/_layout',
      'src/routes/(main)/tasks',
      'src/routes/(main)/task/[taskId]',
      'src/routes/(main)/agent/task/[taskId]',
    ],
    patterns: ['^/(tasks|task|agent/[^/]+/task)(/|$)'],
  },
  {
    id: 'desktop-page',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/page/_layout', 'src/routes/(main)/page', 'src/routes/(main)/page/[id]'],
    patterns: ['^/page(/|$)'],
  },
] as const satisfies RouteChunkPreloadRoute[];

const allJsWarmupManifestFileName = 'assets/js-warmup-manifest.json';

const normalizePath = (value: string) => value.split('?')[0].replaceAll('\\', '/');

const isI18nChunkFileName = (fileName: string) => {
  const normalized = normalizePath(fileName);
  const basename = normalized.split('/').at(-1) ?? normalized;

  return normalized.startsWith('i18n/') || basename.startsWith('i18n-');
};

const stripModuleSuffix = (value: string) =>
  value
    .replace(/\.(mjs|js|jsx|ts|tsx)$/, '')
    .replace(/\.(desktop|mobile|vite|web)$/, '')
    .replace(/\/index$/, '');

function normalizeComparableModuleId(id: string, root = '') {
  let normalized = normalizePath(id);
  const normalizedRoot = root ? normalizePath(root).replace(/\/$/, '') : '';

  if (normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)) {
    normalized = normalized.slice(normalizedRoot.length + 1);
  }

  return stripModuleSuffix(normalized);
}

function isOutputChunk(item: OutputBundleLike[string]): item is OutputChunkLike {
  return item.type === 'chunk';
}

function chunkContainsModule(chunk: OutputChunkLike, moduleId: string, root: string) {
  const expected = normalizeComparableModuleId(moduleId, root);
  const chunkModuleIds = [chunk.facadeModuleId, ...chunk.moduleIds].filter(Boolean);

  return chunkModuleIds.some((id) => normalizeComparableModuleId(id!, root) === expected);
}

function collectChunkDependencies(
  chunk: OutputChunkLike,
  chunksByFileName: Map<string, OutputChunkLike>,
  collected: Set<string>,
  options: { includeDynamicImports?: boolean; includeStaticImports?: boolean },
) {
  if (collected.has(chunk.fileName)) return;

  collected.add(chunk.fileName);

  const imports = [
    ...(options.includeStaticImports ? chunk.imports : []),
    ...(options.includeDynamicImports ? chunk.dynamicImports : []),
  ];

  for (const importedFileName of imports) {
    const importedChunk = chunksByFileName.get(importedFileName);
    if (!importedChunk) continue;
    collectChunkDependencies(importedChunk, chunksByFileName, collected, options);
  }
}

function createRoutePreloadManifest(
  bundle: OutputBundleLike,
  root: string,
  groups: readonly RouteChunkPreloadRoute[] = defaultRoutePreloadGroups,
): RuntimeRoutePreloadEntry[] {
  const chunks = Object.values(bundle).filter(isOutputChunk);
  const chunksByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

  return groups
    .map((route) => {
      const preload = new Set<string>();

      for (const moduleId of route.modules) {
        const matchingChunks = chunks.filter((chunk) => chunkContainsModule(chunk, moduleId, root));

        for (const chunk of matchingChunks) {
          if (route.includeStaticImports || route.includeDynamicImports) {
            collectChunkDependencies(chunk, chunksByFileName, preload, {
              includeDynamicImports: route.includeDynamicImports,
              includeStaticImports: route.includeStaticImports,
            });
          } else {
            preload.add(chunk.fileName);
          }
        }
      }

      return {
        id: route.id,
        patterns: [...route.patterns],
        preload: [...preload].filter((fileName) => fileName.endsWith('.js') && !isI18nChunkFileName(fileName)),
      };
    })
    .filter((entry) => entry.preload.length > 0);
}

function createAssetHref(fileName: string, base: string) {
  if (base === '' || base === './') return fileName;

  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${fileName}`;
}

function createAllJsWarmupManifest(bundle: OutputBundleLike) {
  return Object.values(bundle)
    .filter(isOutputChunk)
    .map((chunk) => chunk.fileName)
    .filter((fileName) => fileName.endsWith('.js') && !isI18nChunkFileName(fileName))
    .sort();
}

function collectExistingHtmlAssets(html: string, base: string) {
  const existing = new Set<string>();
  const sourcePattern = /<(?:link|script)\b[^>]+(?:href|src)="([^"]+)"/g;

  for (const match of html.matchAll(sourcePattern)) {
    const href = match[1];
    const basePrefix = base === '' || base === './' ? '' : base.endsWith('/') ? base : `${base}/`;
    existing.add(basePrefix && href.startsWith(basePrefix) ? href.slice(basePrefix.length) : href.replace(/^\//, ''));
  }

  return existing;
}

function injectRouteModulepreloadsIntoHtml(html: string, manifest: RuntimeRoutePreloadEntry[], base: string) {
  const existing = collectExistingHtmlAssets(html, base);
  const routeFiles = new Set(manifest.flatMap((entry) => entry.preload));
  const links = [...routeFiles]
    .filter((fileName) => !existing.has(fileName))
    .map((fileName) => `    <link rel="modulepreload" crossorigin href="${createAssetHref(fileName, base)}">`);

  if (links.length === 0) return html;

  const injection = links.join('\n');
  const lastModulepreloadMatch = [...html.matchAll(/^[ \t]*<link\s+rel="modulepreload"[^>]*>$/gm)].at(-1);

  if (lastModulepreloadMatch?.index !== undefined) {
    const insertAt = lastModulepreloadMatch.index + lastModulepreloadMatch[0].length;
    return `${html.slice(0, insertAt)}\n${injection}${html.slice(insertAt)}`;
  }

  return html.replace('</head>', `${injection}\n  </head>`);
}

function createIdleWarmupScript(manifest: IdleWarmupManifest, base: string) {
  const payload = {
    allJsManifest: manifest.allJsManifestFileName ? createAssetHref(manifest.allJsManifestFileName, base) : undefined,
    base,
    idleRoutePreload: manifest.idleRoutePreload.map((fileName) => createAssetHref(fileName, base)),
  };

  return [
    '    <script>',
    '      (()=>{',
    `        const m=${JSON.stringify(payload)};`,
    '        const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;',
    '        if(c&&(c.saveData||/(^|-)2g$/.test(c.effectiveType||"")))return;',
    '        const seen=new Set([...document.querySelectorAll("link[href],script[src]")].map((n)=>n.href||n.src));',
    '        const idle=(cb)=>"requestIdleCallback"in window?requestIdleCallback(cb,{timeout:3e3}):setTimeout(()=>cb({didTimeout:true,timeRemaining:()=>16}),1200);',
    '        const visible=(cb)=>document.hidden?document.addEventListener("visibilitychange",()=>!document.hidden&&cb(),{once:true}):cb();',
    '        const run=(items,fn,batch,next)=>{let i=0;const step=(d)=>visible(()=>{let n=0;while(i<items.length&&n<batch&&(d.didTimeout||d.timeRemaining()>6)){fn(items[i++]);n++;}if(i<items.length)idle(step);else next&&idle(next);});idle(step);};',
    '        const addModulepreload=(href)=>{if(seen.has(href))return;seen.add(href);const l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=href;document.head.append(l);};',
    '        const warm=(href)=>{if(seen.has(href))return Promise.resolve();seen.add(href);return fetch(href,{cache:"force-cache",credentials:"same-origin"}).catch(()=>{});};',
    '        const warmQueue=(items)=>{let i=0,a=0;const pump=()=>visible(()=>{while(a<2&&i<items.length){a++;warm(items[i++]).finally(()=>{a--;idle(pump);});}});idle(pump);};',
    '        const toHref=(f)=>new URL(f,m.base&&m.base!=="./"?location.origin+m.base:location.href).href;',
    '        const warmAll=()=>{if(!m.allJsManifest)return;fetch(m.allJsManifest,{cache:"force-cache",credentials:"same-origin"}).then((r)=>r.ok?r.json():[]).then((files)=>warmQueue(files.map(toHref))).catch(()=>{});};',
    '        const start=()=>setTimeout(()=>idle(()=>run(m.idleRoutePreload,addModulepreload,4,()=>setTimeout(()=>idle(warmAll),1.2e4))),2e3);',
    '        document.readyState==="complete"?start():window.addEventListener("load",start,{once:true});',
    '      })();',
    '    </script>',
  ].join('\n');
}

function injectIdleWarmupScriptIntoHtml(html: string, manifest: IdleWarmupManifest, base: string) {
  if (manifest.idleRoutePreload.length === 0 && !manifest.allJsManifestFileName) return html;

  return html.replace('</body>', `${createIdleWarmupScript(manifest, base)}\n  </body>`);
}

interface RouteChunkPreloadOptions {
  allJsWarmup?: boolean;
  groups?: readonly RouteChunkPreloadRoute[];
  idleGroups?: readonly RouteChunkPreloadRoute[];
}

export function routeChunkPreload(options: RouteChunkPreloadOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  const groups = options.groups ?? defaultRoutePreloadGroups;
  const idleGroups = options.idleGroups ?? defaultIdleRoutePreloadGroups;
  const allJsWarmup = options.allJsWarmup ?? true;

  return {
    name: 'lobe-route-chunk-preload',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    generateBundle(_, bundle) {
      if (!allJsWarmup) return;

      this.emitFile({
        fileName: allJsWarmupManifestFileName,
        source: JSON.stringify(createAllJsWarmupManifest(bundle as OutputBundleLike)),
        type: 'asset',
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!config || !ctx.bundle) return html;

        const outputBundle = ctx.bundle as OutputBundleLike;
        const manifest = createRoutePreloadManifest(outputBundle, config.root, groups);
        const idleManifest = createRoutePreloadManifest(outputBundle, config.root, idleGroups);
        const htmlWithInitialPreloads = injectRouteModulepreloadsIntoHtml(html, manifest, config.base);

        return injectIdleWarmupScriptIntoHtml(
          htmlWithInitialPreloads,
          {
            allJsManifestFileName: allJsWarmup ? allJsWarmupManifestFileName : undefined,
            idleRoutePreload: [...new Set(idleManifest.flatMap((entry) => entry.preload))],
          },
          config.base,
        );
      },
    },
  };
}

export const __testing = {
  collectExistingHtmlAssets,
  createAllJsWarmupManifest,
  createAssetHref,
  createIdleWarmupScript,
  createRoutePreloadManifest,
  defaultIdleRoutePreloadGroups,
  defaultRoutePreloadGroups,
  injectIdleWarmupScriptIntoHtml,
  injectRouteModulepreloadsIntoHtml,
};
