import type { Plugin, ResolvedConfig } from 'vite';

interface RouteChunkPreloadRoute {
  id: string;
  includeDynamicImports?: boolean;
  includeStaticImports?: boolean;
  modules: string[];
  patterns: string[];
}

interface RuntimeRoutePreloadEntry {
  id: string;
  idle: string[];
  patterns: string[];
  preload: string[];
}

interface RuntimeWarmupAsset {
  href: string;
  size: number;
}

interface RuntimeWarmupRoute {
  id: string;
  idle: RuntimeWarmupAsset[];
  patterns: string[];
  preload: string[];
}

interface RouteWarmupManifest {
  allJsManifestFileName?: string;
  idleBudgetBytes: number;
  idleMaxChunks: number;
  routes: RuntimeWarmupRoute[];
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

const minInitialRoutePreloadSize = 2048;
const defaultIdleBudgetBytes = 512 * 1024;
const defaultIdleMaxChunks = 12;

const criticalRouteSmallChunkFileNamePatterns = [
  /^EmptyNavItem-/,
  /^HeaderSlot-/,
  /^Item-/,
  /^MainChatInput-/,
  /^Notification-/,
  /^PortalPanel-/,
  /^RenameModal-/,
  /^TokenTag-/,
  /^agent-/,
  /^router-/,
  /^useAgentContext-/,
  /^useAppOrigin-/,
  /^useFetchChatTopics-/,
  /^useFetchThreads-/,
  /^useQueryParam-/,
  /^useTokenCount-/,
  /^useTopicPopupsRegistry-/,
  /^withSuspense-/,
];

const isCriticalRouteSmallChunkFileName = (fileName: string) => {
  const basename = normalizePath(fileName).split('/').at(-1) ?? fileName;

  return criticalRouteSmallChunkFileNamePatterns.some((pattern) => pattern.test(basename));
};

const defaultRoutePreloadGroups = [
  {
    id: 'desktop-chat-launch',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/_layout',
      'src/routes/(main)/agent/_layout',
      'src/routes/(main)/agent/(chat)/_layout',
      'src/routes/(main)/agent',
    ],
    patterns: ['^/(?:[^/]+/)?agent(/|$)'],
  },
] as const satisfies RouteChunkPreloadRoute[];

const defaultIdleRoutePreloadGroups = [
  {
    id: 'desktop-group-chat',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/group/_layout',
      'src/routes/(main)/group',
      'src/routes/(main)/group/profile',
    ],
    patterns: ['^/(?:[^/]+/)?group(/|$)'],
  },
  {
    id: 'desktop-agent-profile',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/agent/profile'],
    patterns: ['^/(?:[^/]+/)?agent/[^/]+/profile(/|$)'],
  },
  {
    id: 'desktop-agent-channel',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/agent/channel'],
    patterns: ['^/(?:[^/]+/)?agent/[^/]+/channel(/|$)'],
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
    patterns: ['^/(?:[^/]+/)?agent/[^/]+(?:/[^/]+)?/page(/|$)'],
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
      'src/routes/(main)/community/(list)/agent',
      'src/routes/(main)/community/(list)/agent/_layout',
      'src/routes/(main)/community/(list)/mcp',
      'src/routes/(main)/community/(list)/mcp/_layout',
      'src/routes/(main)/community/(list)/model',
      'src/routes/(main)/community/(list)/model/_layout',
      'src/routes/(main)/community/(list)/provider',
      'src/routes/(main)/community/(list)/skill',
      'src/routes/(main)/community/(list)/skill/_layout',
      'src/routes/(main)/community/(detail)/agent',
      'src/routes/(main)/community/(detail)/group_agent',
      'src/routes/(main)/community/(detail)/mcp',
      'src/routes/(main)/community/(detail)/model',
      'src/routes/(main)/community/(detail)/provider',
      'src/routes/(main)/community/(detail)/skill',
      'src/routes/(main)/community/(detail)/user',
    ],
    patterns: ['^/(?:[^/]+/)?community(/|$)'],
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
    patterns: ['^/(?:[^/]+/)?resource(/|$)'],
  },
  {
    id: 'desktop-settings',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/settings/_layout', 'src/routes/(main)/settings'],
    patterns: ['^/(?:[^/]+/)?settings(/|$)'],
  },
  {
    id: 'desktop-settings-provider',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: ['src/routes/(main)/settings/provider'],
    patterns: ['^/(?:[^/]+/)?settings/provider(/|$)'],
  },
  {
    id: 'desktop-memory',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/memory/_layout',
      'src/routes/(main)/memory/(home)',
      'src/routes/(main)/memory/activities',
      'src/routes/(main)/memory/contexts',
      'src/routes/(main)/memory/experiences',
      'src/routes/(main)/memory/identities',
      'src/routes/(main)/memory/preferences',
    ],
    patterns: ['^/(?:[^/]+/)?memory(/|$)'],
  },
  {
    id: 'desktop-create',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/(create)/image/_layout',
      'src/routes/(main)/(create)/image',
      'src/routes/(main)/(create)/video/_layout',
      'src/routes/(main)/(create)/video',
    ],
    patterns: ['^/(?:[^/]+/)?(image|video)(/|$)'],
  },
  {
    id: 'desktop-eval',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/eval/_layout',
      'src/routes/(main)/eval/(home)/_layout',
      'src/routes/(main)/eval',
      'src/routes/(main)/eval/bench/[benchmarkId]/_layout',
      'src/routes/(main)/eval/bench/[benchmarkId]',
      'src/routes/(main)/eval/bench/[benchmarkId]/datasets/[datasetId]',
      'src/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]',
      'src/routes/(main)/eval/bench/[benchmarkId]/runs/[runId]/cases/[caseId]',
    ],
    patterns: ['^/(?:[^/]+/)?eval(/|$)'],
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
    patterns: ['^/(?:[^/]+/)?(tasks|task|agent/[^/]+/task)(/|$)'],
  },
  {
    id: 'desktop-page',
    includeDynamicImports: true,
    includeStaticImports: true,
    modules: [
      'src/routes/(main)/page/_layout',
      'src/routes/(main)/page',
      'src/routes/(main)/page/[id]',
    ],
    patterns: ['^/(?:[^/]+/)?page(/|$)'],
  },
] as const satisfies RouteChunkPreloadRoute[];

const allJsWarmupManifestFileName = 'assets/js-warmup-manifest.json';

const normalizePath = (value: string) => value.split('?')[0].replaceAll('\\', '/');

const isI18nChunkFileName = (fileName: string) => {
  const normalized = normalizePath(fileName);
  const basename = normalized.split('/').at(-1) ?? normalized;

  return normalized.startsWith('i18n/') || basename.startsWith('i18n-');
};

const isDevtoolsChunkFileName = (fileName: string) => {
  const normalized = normalizePath(fileName);

  return normalized.includes('/devtools/') || normalized.startsWith('devtools/');
};

const syntaxHighlightModulePatterns = [
  '/node_modules/@shikijs/',
  '/node_modules/shiki/',
  '/node_modules/oniguruma-to-es/',
  '/node_modules/vscode-oniguruma/',
  '/node_modules/vscode-textmate/',
];

const deferredRendererModulePatterns = [
  ...syntaxHighlightModulePatterns,
  '/node_modules/@mermaid-js/',
  '/node_modules/cytoscape/',
  '/node_modules/dagre/',
  '/node_modules/graphlib/',
  '/node_modules/mermaid/',
  '/node_modules/roughjs/',
];

const deferredRendererFileNamePatterns = [
  /(^|\/)(?:github-dark|catppuccin|pierre-dark|pierre-light)-[^/]+\.js$/i,
  /(^|\/)(?:javascript|typescript|tsx|jsx|wasm)-[^/]+\.js$/i,
  /(^|\/)mermaid(?:\.|-)[^/]+\.js$/i,
  /(^|\/)(?:cytoscape|dagre|graphlib|rough)(?:\.|-)[^/]+\.js$/i,
];

function isDeferredRendererChunk(chunk: OutputChunkLike) {
  if (deferredRendererFileNamePatterns.some((pattern) => pattern.test(chunk.fileName))) return true;

  const moduleIds = [chunk.facadeModuleId, ...chunk.moduleIds].filter(Boolean);

  return moduleIds.some((id) => {
    const normalized = normalizePath(id!);

    return deferredRendererModulePatterns.some((pattern) => normalized.includes(pattern));
  });
}

function isPrewarmExcludedChunk(chunk: OutputChunkLike) {
  return (
    isI18nChunkFileName(chunk.fileName) ||
    isDevtoolsChunkFileName(chunk.fileName) ||
    isDeferredRendererChunk(chunk)
  );
}

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

  if (normalized.startsWith('lobehub/src/')) {
    normalized = normalized.slice('lobehub/'.length);
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

function collectStaticChunkDependencies(
  chunk: OutputChunkLike,
  chunksByFileName: Map<string, OutputChunkLike>,
  collected: Set<string>,
) {
  if (collected.has(chunk.fileName)) return;
  if (isPrewarmExcludedChunk(chunk)) return;

  collected.add(chunk.fileName);

  for (const importedFileName of chunk.imports) {
    const importedChunk = chunksByFileName.get(importedFileName);
    if (!importedChunk) continue;
    collectStaticChunkDependencies(importedChunk, chunksByFileName, collected);
  }
}

function collectFirstLevelDynamicDependencies(
  staticFiles: Set<string>,
  chunksByFileName: Map<string, OutputChunkLike>,
) {
  const dynamicFiles = new Set<string>();

  for (const staticFileName of staticFiles) {
    const staticChunk = chunksByFileName.get(staticFileName);
    if (!staticChunk) continue;

    for (const dynamicFileName of staticChunk.dynamicImports) {
      const dynamicChunk = chunksByFileName.get(dynamicFileName);
      if (!dynamicChunk) continue;
      collectStaticChunkDependencies(dynamicChunk, chunksByFileName, dynamicFiles);
    }
  }

  for (const staticFileName of staticFiles) dynamicFiles.delete(staticFileName);

  return dynamicFiles;
}

function createRouteRuntimeManifest(
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
          if (route.includeStaticImports) {
            collectStaticChunkDependencies(chunk, chunksByFileName, preload);
          } else if (!isPrewarmExcludedChunk(chunk)) {
            preload.add(chunk.fileName);
          }
        }
      }

      const idle = route.includeDynamicImports
        ? collectFirstLevelDynamicDependencies(preload, chunksByFileName)
        : new Set<string>();
      const keepJavaScriptChunk = (fileName: string) => {
        const chunk = chunksByFileName.get(fileName);

        return fileName.endsWith('.js') && (!chunk || !isPrewarmExcludedChunk(chunk));
      };

      return {
        id: route.id,
        idle: [...idle].filter(keepJavaScriptChunk),
        patterns: [...route.patterns],
        preload: [...preload].filter(keepJavaScriptChunk),
      };
    })
    .filter((entry) => entry.preload.length > 0 || entry.idle.length > 0);
}

function mergeRouteGroups(
  primaryGroups: readonly RouteChunkPreloadRoute[],
  secondaryGroups: readonly RouteChunkPreloadRoute[],
) {
  const groupsById = new Map<string, RouteChunkPreloadRoute>();

  for (const group of [...primaryGroups, ...secondaryGroups]) {
    const existing = groupsById.get(group.id);
    if (!existing) {
      groupsById.set(group.id, group);
      continue;
    }

    groupsById.set(group.id, {
      id: group.id,
      includeDynamicImports: existing.includeDynamicImports || group.includeDynamicImports,
      includeStaticImports: existing.includeStaticImports || group.includeStaticImports,
      modules: [...new Set([...existing.modules, ...group.modules])],
      patterns: [...new Set([...existing.patterns, ...group.patterns])],
    });
  }

  return [...groupsById.values()];
}

function appendDeploymentQuery(href: string, deploymentId = process.env.VERCEL_DEPLOYMENT_ID) {
  if (!deploymentId || href.includes('dpl=')) return href;

  return `${href}${href.includes('?') ? '&' : '?'}dpl=${deploymentId}`;
}

function createAssetHref(fileName: string, base: string, deploymentId?: string) {
  if (base === '' || base === './') return appendDeploymentQuery(fileName, deploymentId);

  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return appendDeploymentQuery(`${normalizedBase}${fileName}`, deploymentId);
}

function createAllJsWarmupManifest(bundle: OutputBundleLike) {
  return Object.values(bundle)
    .filter(isOutputChunk)
    .filter((chunk) => chunk.fileName.endsWith('.js') && !isPrewarmExcludedChunk(chunk))
    .map((chunk) => chunk.fileName)
    .sort();
}

function normalizeHtmlAssetHref(href: string, base: string) {
  const cleanHref = href.split('?')[0];
  const basePrefix = base === '' || base === './' ? '' : base.endsWith('/') ? base : `${base}/`;

  return basePrefix && cleanHref.startsWith(basePrefix)
    ? cleanHref.slice(basePrefix.length)
    : cleanHref.replaceAll(/^\//g, '');
}

function removeSmallModulepreloadsFromHtml(
  html: string,
  base: string,
  shouldKeepFile: (fileName: string) => boolean,
) {
  return html.replaceAll(
    /^[ \t]*<link\s+rel="modulepreload"[^>]*href="([^"]+)"[^>]*>\n?/gm,
    (match, href: string) => {
      const fileName = normalizeHtmlAssetHref(href, base);

      return shouldKeepFile(fileName) ? match : '';
    },
  );
}

function selectWarmupAssetsWithinBudget(
  assets: RuntimeWarmupAsset[],
  budgetBytes: number,
  maxChunks: number,
) {
  const selected: RuntimeWarmupAsset[] = [];
  const seen = new Set<string>();
  let usedBytes = 0;

  for (const asset of assets) {
    if (seen.has(asset.href)) continue;
    seen.add(asset.href);
    if (selected.length >= maxChunks) break;
    if (asset.size > budgetBytes - usedBytes) continue;
    selected.push(asset);
    usedBytes += asset.size;
  }

  return selected;
}

function createRouteWarmupScript(
  manifest: RouteWarmupManifest,
  base: string,
  deploymentId?: string,
) {
  const payload = {
    allJsManifest: manifest.allJsManifestFileName
      ? createAssetHref(manifest.allJsManifestFileName, base, deploymentId)
      : undefined,
    base,
    idleBudgetBytes: manifest.idleBudgetBytes,
    idleMaxChunks: manifest.idleMaxChunks,
    routes: manifest.routes,
  };

  return [
    '    <script>',
    '      (()=>{',
    `        const m=${JSON.stringify(payload)};`,
    '        const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;',
    '        if(c&&(c.saveData||/(^|-)2g$/.test(c.effectiveType||"")))return;',
    '        const toHref=(f)=>new URL(f,m.base&&m.base!=="./"?location.origin+m.base:location.href).href;',
    '        const seen=new Set([...document.querySelectorAll("link[href],script[src]")].map((n)=>n.href||n.src).filter(Boolean).map(toHref));',
    '        const idle=(cb)=>"requestIdleCallback"in window?requestIdleCallback(cb,{timeout:3e3}):setTimeout(()=>cb({didTimeout:true,timeRemaining:()=>16}),1200);',
    '        const visible=(cb)=>document.hidden?document.addEventListener("visibilitychange",()=>!document.hidden&&cb(),{once:true}):cb();',
    '        const matchRoutes=(pathname)=>m.routes.filter((route)=>route.patterns.some((pattern)=>{try{return new RegExp(pattern).test(pathname);}catch{return false;}}));',
    '        const addModulepreload=(value)=>{const href=toHref(value);if(seen.has(href))return;seen.add(href);const l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href=href;document.head.append(l);};',
    '        const warm=(value)=>{const href=toHref(value);if(seen.has(href))return Promise.resolve();seen.add(href);return fetch(href,{cache:"force-cache",credentials:"same-origin"}).catch(()=>{});};',
    '        const warmQueue=(items,done)=>{let i=0,a=0,finished=false;const finish=()=>{if(finished)return;finished=true;done&&done();};const pump=()=>visible(()=>{while(a<2&&i<items.length){a++;warm(items[i++]).finally(()=>{a--;idle(pump);});}if(i>=items.length&&a===0)finish();});items.length?idle(pump):finish();};',
    '        const selectIdle=(routes)=>{const selected=[],seenIdle=new Set();let used=0;for(const item of routes.flatMap((route)=>route.idle)){if(seenIdle.has(item.href))continue;seenIdle.add(item.href);if(selected.length>=m.idleMaxChunks)break;if(item.size>m.idleBudgetBytes-used)continue;selected.push(item.href);used+=item.size;}return selected;};',
    '        const preloadRoutes=(routes)=>routes.forEach((route)=>route.preload.forEach(addModulepreload));',
    '        const currentRoutes=matchRoutes(location.pathname);',
    '        preloadRoutes(currentRoutes);',
    '        const warmedRouteIds=new Set(currentRoutes.map((route)=>route.id));',
    '        const warmIntent=(event)=>{const anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;let url;try{url=new URL(anchor.href,location.href);}catch{return;}if(url.origin!==location.origin)return;const routes=matchRoutes(url.pathname).filter((route)=>!warmedRouteIds.has(route.id));if(!routes.length)return;routes.forEach((route)=>warmedRouteIds.add(route.id));preloadRoutes(routes);};',
    '        document.addEventListener("pointerover",warmIntent,{capture:true,passive:true});',
    '        document.addEventListener("focusin",warmIntent,{capture:true,passive:true});',
    '        document.addEventListener("touchstart",warmIntent,{capture:true,passive:true});',
    '        const warmAll=()=>{if(!m.allJsManifest)return;fetch(toHref(m.allJsManifest),{cache:"force-cache",credentials:"same-origin"}).then((r)=>r.ok?r.json():[]).then((files)=>warmQueue(files)).catch(()=>{});};',
    '        const start=()=>setTimeout(()=>idle(()=>warmQueue(selectIdle(currentRoutes),()=>setTimeout(()=>idle(warmAll),1.2e4))),2e3);',
    '        document.readyState==="complete"?start():window.addEventListener("load",start,{once:true});',
    '      })();',
    '    </script>',
  ].join('\n');
}

function injectRouteWarmupScriptIntoHtml(
  html: string,
  manifest: RouteWarmupManifest,
  base: string,
  deploymentId?: string,
) {
  if (manifest.routes.length === 0 && !manifest.allJsManifestFileName) return html;

  const script = createRouteWarmupScript(manifest, base, deploymentId);

  return html.includes('</head>')
    ? html.replace('</head>', `${script}\n  </head>`)
    : html.replace('</body>', `${script}\n  </body>`);
}

interface RouteChunkPreloadOptions {
  allJsWarmup?: boolean;
  groups?: readonly RouteChunkPreloadRoute[];
  idleBudgetBytes?: number;
  idleGroups?: readonly RouteChunkPreloadRoute[];
  idleMaxChunks?: number;
}

export function routeChunkPreload(options: RouteChunkPreloadOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  const groups = options.groups ?? defaultRoutePreloadGroups;
  const idleGroups = options.idleGroups ?? defaultIdleRoutePreloadGroups;
  const allJsWarmup = options.allJsWarmup ?? false;
  const idleBudgetBytes = options.idleBudgetBytes ?? defaultIdleBudgetBytes;
  const idleMaxChunks = options.idleMaxChunks ?? defaultIdleMaxChunks;

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
        // The auth SPA shares the build but must not preload main-app routes
        if (ctx.path?.includes('index.auth')) return html;

        const outputBundle = ctx.bundle as OutputBundleLike;
        const manifest = createRouteRuntimeManifest(
          outputBundle,
          config.root,
          mergeRouteGroups(groups, idleGroups),
        );
        const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
        const chunkSizeByFileName = new Map(
          Object.values(outputBundle)
            .filter(isOutputChunk)
            .map((chunk) => [chunk.fileName, Buffer.byteLength(chunk.code)]),
        );
        const htmlWithoutSmallPreloads = removeSmallModulepreloadsFromHtml(
          html,
          config.base,
          (fileName) =>
            (chunkSizeByFileName.get(fileName) ?? minInitialRoutePreloadSize) >=
            minInitialRoutePreloadSize,
        );
        const runtimeRoutes = manifest.map<RuntimeWarmupRoute>((route) => ({
          id: route.id,
          idle: route.idle
            .map((fileName) => ({
              href: createAssetHref(fileName, config.base, deploymentId),
              size: chunkSizeByFileName.get(fileName) ?? 0,
            }))
            .filter(
              ({ href, size }) =>
                size >= minInitialRoutePreloadSize || isCriticalRouteSmallChunkFileName(href),
            ),
          patterns: route.patterns,
          preload: route.preload
            .filter(
              (fileName) =>
                (chunkSizeByFileName.get(fileName) ?? minInitialRoutePreloadSize) >=
                minInitialRoutePreloadSize,
            )
            .map((fileName) => createAssetHref(fileName, config.base, deploymentId)),
        }));

        return injectRouteWarmupScriptIntoHtml(
          htmlWithoutSmallPreloads,
          {
            allJsManifestFileName: allJsWarmup ? allJsWarmupManifestFileName : undefined,
            idleBudgetBytes,
            idleMaxChunks,
            routes: runtimeRoutes,
          },
          config.base,
          deploymentId,
        );
      },
    },
  };
}

export const __testing = {
  appendDeploymentQuery,
  createAllJsWarmupManifest,
  createAssetHref,
  createRouteRuntimeManifest,
  createRouteWarmupScript,
  defaultIdleRoutePreloadGroups,
  defaultRoutePreloadGroups,
  injectRouteWarmupScriptIntoHtml,
  removeSmallModulepreloadsFromHtml,
  selectWarmupAssetsWithinBudget,
};
