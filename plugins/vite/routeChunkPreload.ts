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
  patterns: string[];
  preload: string[];
}

interface IdleWarmupManifest {
  allJsManifestFileName?: string;
  idleRouteFetch: string[];
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

const minInitialRoutePreloadSize = 2048;

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
    patterns: ['^/agent(/|$)'],
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
    patterns: ['^/group(/|$)'],
  },
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
    patterns: ['^/memory(/|$)'],
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
    patterns: ['^/(image|video)(/|$)'],
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
    patterns: ['^/eval(/|$)'],
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
    modules: [
      'src/routes/(main)/page/_layout',
      'src/routes/(main)/page',
      'src/routes/(main)/page/[id]',
    ],
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
  return isI18nChunkFileName(chunk.fileName) || isDeferredRendererChunk(chunk);
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

function collectChunkDependencies(
  chunk: OutputChunkLike,
  chunksByFileName: Map<string, OutputChunkLike>,
  collected: Set<string>,
  options: { includeDynamicImports?: boolean; includeStaticImports?: boolean },
) {
  if (collected.has(chunk.fileName)) return;
  if (isPrewarmExcludedChunk(chunk)) return;

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
        preload: [...preload].filter((fileName) => {
          const chunk = chunksByFileName.get(fileName);

          return fileName.endsWith('.js') && (!chunk || !isPrewarmExcludedChunk(chunk));
        }),
      };
    })
    .filter((entry) => entry.preload.length > 0);
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

function collectExistingHtmlAssets(html: string, base: string) {
  const existing = new Set<string>();
  const sourcePattern = /<(?:link|script)\b[^>]+(?:href|src)="([^"]+)"/g;

  for (const match of html.matchAll(sourcePattern)) {
    existing.add(normalizeHtmlAssetHref(match[1], base));
  }

  return existing;
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

function injectRouteModulepreloadsIntoHtml(
  html: string,
  manifest: RuntimeRoutePreloadEntry[],
  base: string,
  deploymentId?: string,
  shouldInjectFile: (fileName: string) => boolean = () => true,
) {
  const existing = collectExistingHtmlAssets(html, base);
  const routeFiles = new Set(manifest.flatMap((entry) => entry.preload));
  const links = [...routeFiles]
    .filter(shouldInjectFile)
    .filter((fileName) => !existing.has(fileName))
    .map(
      (fileName) =>
        `    <link rel="modulepreload" crossorigin href="${createAssetHref(fileName, base, deploymentId)}">`,
    );

  if (links.length === 0) return html;

  const injection = links.join('\n');
  const lastModulepreloadMatch = [
    ...html.matchAll(/^[ \t]*<link\s+rel="modulepreload"[^>]*>$/gm),
  ].at(-1);

  if (lastModulepreloadMatch?.index !== undefined) {
    const insertAt = lastModulepreloadMatch.index + lastModulepreloadMatch[0].length;
    return `${html.slice(0, insertAt)}\n${injection}${html.slice(insertAt)}`;
  }

  return html.replace('</head>', `${injection}\n  </head>`);
}

function createIdleWarmupScript(manifest: IdleWarmupManifest, base: string, deploymentId?: string) {
  const payload = {
    allJsManifest: manifest.allJsManifestFileName
      ? createAssetHref(manifest.allJsManifestFileName, base, deploymentId)
      : undefined,
    base,
    idleRouteFetch: manifest.idleRouteFetch.map((fileName) =>
      createAssetHref(fileName, base, deploymentId),
    ),
    idleRoutePreload: manifest.idleRoutePreload.map((fileName) =>
      createAssetHref(fileName, base, deploymentId),
    ),
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
    '        const start=()=>setTimeout(()=>idle(()=>run(m.idleRoutePreload,addModulepreload,4,()=>{warmQueue(m.idleRouteFetch||[]);setTimeout(()=>idle(warmAll),1.2e4);})),2e3);',
    '        document.readyState==="complete"?start():window.addEventListener("load",start,{once:true});',
    '      })();',
    '    </script>',
  ].join('\n');
}

function injectIdleWarmupScriptIntoHtml(
  html: string,
  manifest: IdleWarmupManifest,
  base: string,
  deploymentId?: string,
) {
  if (
    manifest.idleRoutePreload.length === 0 &&
    manifest.idleRouteFetch.length === 0 &&
    !manifest.allJsManifestFileName
  )
    return html;

  return html.replace(
    '</body>',
    `${createIdleWarmupScript(manifest, base, deploymentId)}\n  </body>`,
  );
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
  const allJsWarmup = options.allJsWarmup ?? false;

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
        const htmlWithInitialPreloads = injectRouteModulepreloadsIntoHtml(
          htmlWithoutSmallPreloads,
          manifest,
          config.base,
          deploymentId,
          (fileName) =>
            (chunkSizeByFileName.get(fileName) ?? minInitialRoutePreloadSize) >=
            minInitialRoutePreloadSize,
        );

        return injectIdleWarmupScriptIntoHtml(
          htmlWithInitialPreloads,
          {
            allJsManifestFileName: allJsWarmup ? allJsWarmupManifestFileName : undefined,
            idleRouteFetch: [],
            idleRoutePreload: [
              ...new Set([
                ...manifest
                  .flatMap((entry) => entry.preload)
                  .filter((fileName) => {
                    const size = chunkSizeByFileName.get(fileName) ?? minInitialRoutePreloadSize;

                    return (
                      size >= minInitialRoutePreloadSize ||
                      isCriticalRouteSmallChunkFileName(fileName)
                    );
                  }),
                ...idleManifest
                  .flatMap((entry) => entry.preload)
                  .filter(
                    (fileName) =>
                      (chunkSizeByFileName.get(fileName) ?? minInitialRoutePreloadSize) >=
                      minInitialRoutePreloadSize,
                  ),
              ]),
            ],
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
  collectExistingHtmlAssets,
  createAllJsWarmupManifest,
  createAssetHref,
  createIdleWarmupScript,
  createRoutePreloadManifest,
  defaultIdleRoutePreloadGroups,
  defaultRoutePreloadGroups,
  injectIdleWarmupScriptIntoHtml,
  injectRouteModulepreloadsIntoHtml,
  removeSmallModulepreloadsFromHtml,
};
