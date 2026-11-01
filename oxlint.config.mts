import { readFileSync } from 'node:fs';

import { defineConfig, type UserOverride } from '@lobehub/oxlint-config';
import { restrictedImports } from '@lobehub/ui/eslint';

import {
  browserBundleRestrictedImportPaths,
  performanceRestrictedImportPaths,
  performanceRestrictedImportPatterns,
} from './lint.bundleBoundaries.mjs';
import { stylexMigrationOverrides } from './scripts/stylexMigration/oxlint.mjs';

const [, uiRestrictedImportOptions] = restrictedImports.rules['no-restricted-imports'] as [
  string,
  { paths: { message: string; name: string }[]; patterns?: object[] },
];

const baseRestrictedImportOptions = {
  ...uiRestrictedImportOptions,
  patterns: [
    ...(uiRestrictedImportOptions.patterns ?? []),
    {
      regex: '^@modelcontextprotocol/(?:sdk)(/|$)',
      message:
        'Use the v2 @modelcontextprotocol/client, @modelcontextprotocol/server or @modelcontextprotocol/node packages.',
    },
  ],
};

// On desktop the shell — every NavPanelPortal sidebar, the titlebar, the command
// menu — renders as a sibling of TabHost, so React context binds these hooks to
// the frozen root router while page content lives in per-tab memory routers.
// A write then lands on a router no page reads and a read resolves the boot url,
// silently and only on desktop. `Link` stays allowed: the convention is a real
// href plus an onClick that preventDefaults into the navigation facade.
const shellRouterRestrictedPaths = [
  {
    importNames: [
      'useLocation',
      'useMatch',
      'useMatches',
      'useNavigate',
      'useParams',
      'useSearchParams',
    ],
    message:
      'Shell trees render outside the per-tab router. Read with useActiveLocation / useActiveRouteParams and navigate with useWorkspaceAwareNavigate. There is no active-tab twin for useSearchParams: express the write as a facade navigation, or move the url state into the route tree that owns it.',
    name: 'react-router',
  },
  {
    importNames: ['useQueryParam', 'useQueryState'],
    message:
      'useQueryState wraps useSearchParams, so it binds to the frozen root router here. Move the url state into the route tree that owns it, or write through the navigation facade.',
    name: '@/hooks/useQueryParam',
  },
];

// Runtime boundary of @lobechat/heterogeneous-agents: browser code may import
// values only from the entries listed in browser-entries.json; every other
// subpath is Node-only (spawn, rpc, quota-sampler, ...). New entries are
// Node-only until listed there, and the package's runtimeBoundary test keeps
// the listed entries free of Node code.
const heteroBrowserEntries: string[] = JSON.parse(
  readFileSync(
    new URL('packages/heterogeneous-agents/browser-entries.json', import.meta.url),
    'utf8',
  ),
);
const heteroBrowserSubpaths = heteroBrowserEntries
  .filter((entry) => entry !== '.')
  .map((entry) => entry.slice(2));
const runtimeRestrictedImportPatterns = [
  {
    allowTypeImports: true,
    message:
      'This @lobechat/heterogeneous-agents entry is Node-only. Browser code may import values only from the entries in packages/heterogeneous-agents/browser-entries.json; type imports are fine.',
    regex: `^@lobechat/heterogeneous-agents/(?!(?:${heteroBrowserSubpaths.join('|')})$)`,
  },
];

// Browser runtime boundary for the SPA and the Electron renderer: server code,
// database access and Node built-ins never run there. Vite stubs a Node
// built-in with a module that throws on first access, and a server import
// drags its whole graph (database drivers, env) into the bundle. Type imports
// are erased and stay allowed. Server-side trees under src/ (Next.js shells,
// src/libs, instrumentation, proxy) opt out with `serverSide: true`.
// Whether a third-party package needs Node is a judgement call; the alint
// rule `lobehub/no-node-in-browser` covers that part.
const NODE_BUILTINS = [
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'module',
  'net',
  'os',
  'path',
  'readline',
  'stream',
  'tls',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];
const browserRuntimeRestrictedImportPaths = NODE_BUILTINS.flatMap((name) => [
  name,
  `node:${name}`,
]).map((name) => ({
  allowTypeImports: true,
  message:
    'Node built-ins do not exist in the browser. Move the work behind a server endpoint or an Electron IPC call; type imports are fine.',
  name,
}));
const browserRuntimeRestrictedImportPatterns = [
  {
    allowTypeImports: true,
    message:
      'Server code does not run in the browser. Call it through a TRPC service, or move a pure helper into a shared package; type imports are fine.',
    regex: String.raw`^@/(server|app/\(backend\))/`,
  },
  {
    allowTypeImports: true,
    message:
      'Database models, repositories and clients are server-only. Read through a TRPC service; schemas and type imports are fine.',
    regex: '^(@/database|@lobechat/database)/(models|repositories|server|core)(/|$)',
  },
];

// Business code uses domain methods in services/redis. The client lib is infrastructure.
// Existing consumers are migration debt; this list only shrinks.
const redisAccessRestrictedImportPaths = [
  {
    message:
      'Redis service connections are internal. Use domain methods from @/server/services/redis.',
    name: '@/server/services/redis/client',
  },
  {
    allowTypeImports: true,
    message:
      'Redis client access belongs inside services/redis. Use a domain method or add one there.',
    name: '@/server/modules/Redis',
  },
  {
    allowTypeImports: true,
    message:
      'Server code must not open its own ioredis client. Use domain methods in "@/server/services/redis"; add missing business capabilities there.',
    name: 'ioredis',
  },
  {
    message:
      'The raw agent-runtime Redis client is legacy. New code uses domain methods in "@/server/services/redis".',
    name: '@/server/modules/AgentRuntime/redis',
  },
];
const redisAccessRestrictedSyntax = [
  {
    message:
      'Server code must not open its own ioredis client, not even lazily. Use "@/server/services/redis".',
    selector: "ImportExpression > Literal[value='ioredis']",
  },
  {
    message: 'Redis client access belongs inside services/redis.',
    selector: 'ImportExpression > Literal[value=/^@\\/server\\/modules\\/Redis(?:\\/|$)/]',
  },
];
// Server output is source English. Translation catalogs and runtimes stay with the clients.
const serverI18nMessage =
  'Server code renders source English and must not load translation catalogs or i18n runtimes.';
const serverI18nRestrictedImportPaths = [
  { message: serverI18nMessage, name: 'i18next' },
  { message: serverI18nMessage, name: 'react-i18next' },
];
const serverI18nRestrictedImportPatterns = [
  {
    group: [
      '@/locales/*',
      '!@/locales/resources',
      '@lobechat/locales',
      '@lobechat/locales/*',
      '!@lobechat/locales/resources',
      '@/libs/i18n',
      '@/libs/i18n/*',
      '**/locales/*/*.json',
    ],
    message: serverI18nMessage,
  },
];

const legacyRawRedisClientConsumers = [
  'apps/server/src/services/home/index.ts',
  'apps/server/src/services/agent/index.ts',
  'apps/server/src/services/file/impls/s3.ts',
  'apps/server/src/services/generation/latency.ts',
  'apps/server/src/workflows/runGuard/store.ts',
  'apps/server/src/runtimeConfig/providers/RedisRuntimeConfigProvider.ts',
  'apps/server/src/router-hono/workflows/memory-user-memory/workflows/runGuard.ts',
  'apps/server/src/modules/AgentRuntime/redis.ts',
  'apps/server/src/modules/AgentRuntime/AgentStateManager.ts',
  'apps/server/src/modules/AgentRuntime/StreamEventManager.ts',
  'apps/server/src/modules/AgentRuntime/adapters/ServerLLMTransport.ts',
  'apps/server/src/modules/AgentRuntime/dispatchClientTool.ts',
  'apps/server/src/modules/AgentRuntime/factory.ts',
  'apps/server/src/router-hono/agent/handlers/gatewayCron.ts',
  'apps/server/src/router-hono/agent/handlers/llmRelay.ts',
  'apps/server/src/router-hono/agent/handlers/toolResult.ts',
  'apps/server/src/router-hono/webhooks/handlers/github.ts',
  'apps/server/src/routers/lambda/messenger/wechat.ts',
  'apps/server/src/services/agentRuntime/opportunisticSweep.ts',
  'apps/server/src/services/agentSignal/store/adapters/redis/shared.ts',
  'apps/server/src/services/bot/BotCallbackService.ts',
  'apps/server/src/services/bot/BotMessageRouter/index.ts',
  'apps/server/src/services/bot/deferredMessages.ts',
  'apps/server/src/services/bot/platforms/discord/chatComposition.ts',
  'apps/server/src/services/bot/platforms/feishu/chatComposition.ts',
  'apps/server/src/services/bot/platforms/feishu/reactionTracker.ts',
  'apps/server/src/services/bot/platforms/telegram/guestSession.ts',
  'apps/server/src/services/bot/platforms/wechat/service.ts',
  'apps/server/src/services/bot/reactionState.ts',
  'apps/server/src/services/connector/stateStore.ts',
  'apps/server/src/services/editLock/index.ts',
  'apps/server/src/services/gateway/GatewayManager.ts',
  'apps/server/src/services/gateway/botConnectQueue.ts',
  'apps/server/src/services/gateway/runtimeStatus.ts',
  'apps/server/src/services/messenger/MessengerRouter/index.ts',
  'apps/server/src/services/messenger/installations/wechat.ts',
  'apps/server/src/services/messenger/linkTokenStore.ts',
  'apps/server/src/services/messenger/oauth/stateStore.ts',
  'apps/server/src/services/messenger/platforms/linq/webhook.ts',
  'apps/server/src/services/messenger/platforms/wechat/binder.ts',
  'apps/server/src/services/messenger/wechatPush.ts',
  'apps/server/src/services/messenger/wechatQrSessionStore.ts',
  'apps/server/src/services/onboardingProgress/index.ts',
  'apps/server/src/services/resourceEvents/index.ts',
  'apps/server/src/services/scm/ScmControlService.ts',
  'apps/server/src/services/scm/oauth/stateStore.ts',
  'apps/server/src/services/taskResultBridge/redisStore.ts',
  'apps/server/src/services/toolExecution/serverRuntimes/lobeAgent.ts',
  'apps/server/src/services/toolExecution/serverRuntimes/message/index.ts',
  'apps/server/src/services/understanding/sourceStore.ts',
];

interface RestrictedImportRuleOptions {
  paths?: object[];
  patterns?: object[];
  serverSide?: boolean;
}

const createRestrictedImportRule = ({
  paths = [],
  patterns,
  serverSide = false,
}: RestrictedImportRuleOptions = {}) => [
  'error',
  {
    ...baseRestrictedImportOptions,
    paths: [
      ...(baseRestrictedImportOptions.paths ?? []),
      ...performanceRestrictedImportPaths,
      ...(serverSide ? [] : browserRuntimeRestrictedImportPaths),
      ...(serverSide ? [] : browserBundleRestrictedImportPaths),
      ...paths,
    ],
    patterns: [
      ...(baseRestrictedImportOptions.patterns ?? []),
      ...runtimeRestrictedImportPatterns,
      ...performanceRestrictedImportPatterns,
      ...(serverSide ? [] : browserRuntimeRestrictedImportPatterns),
      ...(patterns ?? []),
    ],
  },
];

// useRef(initial) re-evaluates `initial` on every render. Ban call/new expressions
// so expensive work and empty Map/Set allocations don't happen as throwaway inits.
// Use useSingleton(() => ...) for a once-created value; do not wrap it in useRef.
const useRefLazyInitMessage =
  "Do not pass a call or `new` expression to useRef() — the argument is evaluated on every render. Use useSingleton(() => ...) from '@/hooks/useSingleton' instead (do not wrap useSingleton in useRef).";

const useRefLazyInitRestrictedSyntax = [
  {
    message: useRefLazyInitMessage,
    selector: "CallExpression[callee.name='useRef'] > CallExpression.arguments:first-child",
  },
  {
    message: useRefLazyInitMessage,
    selector:
      "CallExpression[callee.property.name='useRef'] > CallExpression.arguments:first-child",
  },
  {
    message: useRefLazyInitMessage,
    selector: "CallExpression[callee.name='useRef'] > NewExpression.arguments:first-child",
  },
  {
    message: useRefLazyInitMessage,
    selector: "CallExpression[callee.property.name='useRef'] > NewExpression.arguments:first-child",
  },
];

// Review rule: no all-caps labels. stylelint covers stylesheets; this covers
// inline style objects.
const uppercaseRestrictedSyntax = [
  {
    message: "Do not set textTransform: 'uppercase'; write the label in the case it should read.",
    selector: "Property[key.name='textTransform'][value.value='uppercase']",
  },
];

const electronIpcRemoveListenerRestrictedSyntax = {
  message:
    'Do not use removeListener in renderer code. Electron contextBridge does not preserve listener identity across calls; use the disposer returned by ipcRenderer.on().',
  selector: "CallExpression > MemberExpression.callee[property.name='removeListener']",
};

const CORE = ['eslint-core'] satisfies UserOverride['jsPlugins'];

const restrictImports = (
  files: string[],
  rule: unknown,
  excludeFiles?: string[],
): UserOverride => ({
  files,
  ...(excludeFiles && { excludeFiles }),
  jsPlugins: CORE,
  rules: { 'eslint-core/no-restricted-imports': rule as never },
});

const restrictSyntax = (
  files: string[],
  selectors: object[],
  excludeFiles?: string[],
): UserOverride => ({
  files,
  ...(excludeFiles && { excludeFiles }),
  jsPlugins: CORE,
  rules: { 'eslint-core/no-restricted-syntax': ['error', ...selectors] as never },
});

export default defineConfig(
  {
    ignores: [
      // Vendored skill releases; maintained in lobehub/acceptance and lobehub/lobe-design-skill.
      '.agents/skills/{acceptance,lobe-design}/**',
      // Generated by `bun run shell:vendor` in apps/desktop.
      'apps/desktop/shell/rescue/electron-updater.cjs',
      // Vendored unchanged from the Agent Secret Channel reference implementation.
      'packages/secret-channel/src/asc/**',
      'packages/secret-channel/test/vectors/**',
      'packages/secret-channel/test/vectors.test.ts',
      // dependencies
      'node_modules',
      // ci
      'coverage',
      '.coverage',
      // test
      'jest*',
      '*.test.ts',
      '*.test.tsx',
      // umi
      '.umi',
      '.umi-production',
      '.umi-test',
      '.dumi/tmp*',
      // production
      'dist',
      'es',
      'lib',
      'logs',
      // misc
      '.next',
      // temporary directories
      'tmp',
      'temp',
      '.temp',
      '.local',
      'docs/.local',
      // cache directories
      '.cache',
      // AI coding tools directories
      '.claude',
      '.serena',
      '.i18nrc.js',
      // vendored code (copied from @microsoft/fetch-event-source)
      'packages/utils/src/client/fetchEventSource/parse.ts',
      // generated files (regenerate with `bun generate` in packages/sdk)
      'packages/sdk/src/generated/**',
      // generated files (regenerate with `codex app-server generate-ts`)
      'packages/heterogeneous-agents/src/codex/protocol/generated.ts',
    ],
    next: true,
    react: 'next',
    stylex: true,
  },
  restrictImports(['**/*'], ['error', baseRestrictedImportOptions]),
  // Performance import boundaries. These restrictions preserve real import()
  // seams instead of relying on component-level conditional rendering.
  restrictImports(
    ['src/**/*.{ts,tsx}', 'apps/share/src/**/*.{ts,tsx}'],
    createRestrictedImportRule(),
  ),
  // Server-side trees under src/: Next.js shells and route handlers, server
  // helpers, instrumentation and the proxy may import server code.
  restrictImports(
    [
      'src/app/**/*.{ts,tsx}',
      'src/libs/**/*.{ts,tsx}',
      'src/scripts/**/*.{ts,tsx}',
      'src/*.{ts,tsx}',
      'src/**/*.server.{ts,tsx}',
    ],
    createRestrictedImportRule({ serverSide: true }),
  ),
  // Bundle-size restrictions target shipped code; tests may reach the barrels.
  restrictImports(['src/**/*.test.{ts,tsx}'], ['error', baseRestrictedImportOptions]),
  // Boot-path trees are statically reachable from the SPA entry. A heavy
  // @lobehub/ui member imported here lands in the first-screen chunk together
  // with shiki / katex / elkjs / emoji data; the CI entry-graph gate catches
  // the regression, this rule explains it at the import site.
  restrictImports(
    [
      'src/layout/**/*.{ts,tsx}',
      'src/spa/**/*.{ts,tsx}',
      'src/store/**/*.{ts,tsx}',
      'src/utils/**/*.{ts,tsx}',
      // The main layout and the home route are the first navigation's closure.
      'src/routes/**/_layout/**/*.{ts,tsx}',
      'src/routes/(main)/home/**/*.{ts,tsx}',
      'src/features/Home/**/*.{ts,tsx}',
      'src/features/HomeSidebar/**/*.{ts,tsx}',
      'src/features/NavPanel/**/*.{ts,tsx}',
    ],
    createRestrictedImportRule({
      paths: [
        {
          importNames: [
            'CodeDiff',
            'CodeEditor',
            'EmojiPicker',
            'Highlighter',
            'HtmlPreview',
            'Markdown',
            'Mermaid',
            'PatchDiff',
            'Snippet',
            'SortableList',
            'SyntaxHighlighter',
            'SyntaxMermaid',
          ],
          message:
            'Boot-path modules must not statically import heavy @lobehub/ui members. Load them with lazy(() => import("@lobehub/ui/es/<Member>/index")) or move the consumer into a route tree.',
          name: '@lobehub/ui',
        },
        {
          message:
            'Boot-path modules must load EmojiPicker with lazy(); it carries the emoji-mart dataset.',
          name: '@/components/EmojiPicker',
        },
        {
          allowTypeImports: true,
          message:
            'Boot-path modules must not import @lobehub/analytics; it bundles posthog-js. Use "@/libs/analytics/client", which loads it after first paint and queues events.',
          name: '@lobehub/analytics',
        },
        {
          allowTypeImports: true,
          message:
            'Boot-path modules must not import @lobehub/analytics/react; use useAnalytics from "@/libs/analytics/client".',
          name: '@lobehub/analytics/react',
        },
      ],
      patterns: [
        {
          message:
            'The builtin tool client barrel exports the whole render registry. Import the dedicated subpath (e.g. "/client/displayControls") or resolve renders lazily.',
          regex: '^@lobechat/builtin-tool-[^/]+/client(?:$|/index$)',
        },
      ],
    }),
    ['src/**/*.test.{ts,tsx}', 'src/layout/AuthProvider/MarketAuth/ProfileSetupModal.tsx'],
  ),
  restrictImports(
    ['src/components/Skeleton/**/*.{ts,tsx}'],
    createRestrictedImportRule({
      paths: [
        {
          name: '@/components/Skeleton',
          message:
            'Skeleton internals must import sibling components directly to avoid a cycle through their own barrel.',
        },
        {
          name: '@/components/Skeleton/index',
          message:
            'Skeleton internals must import sibling components directly to avoid a cycle through their own barrel.',
        },
      ],
    }),
  ),
  restrictImports(
    ['src/features/Conversation/**/*.{ts,tsx}'],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'Conversation internals must use stable subpaths such as "./store", "./ConversationProvider", or "./Messages" instead of the root barrel.',
          name: '@/features/Conversation',
        },
      ],
    }),
  ),
  restrictImports(
    ['src/features/NavPanel/**/*.{ts,tsx}'],
    createRestrictedImportRule({
      paths: shellRouterRestrictedPaths,
      patterns: [
        {
          group: [
            '@/routes/**/_layout/Sidebar',
            '@/routes/**/_layout/Sidebar/**',
            '@/routes/**/_layout/SideBar',
            '@/routes/**/_layout/SideBar/**',
          ],
          message:
            'NavPanel must not own route Sidebar implementations. Register route content through NavPanelPortal.',
        },
      ],
    }),
  ),
  restrictImports(
    [
      'src/routes/**/_layout/Sidebar.{ts,tsx}',
      'src/routes/**/_layout/Sidebar/**/*.{ts,tsx}',
      'src/routes/**/_layout/SideBar.{ts,tsx}',
      'src/routes/**/_layout/SideBar/**/*.{ts,tsx}',
    ],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'Route Sidebars must import NavPanelPortal from its dedicated subpath instead of the NavPanel host barrel.',
          name: '@/features/NavPanel',
        },
        ...shellRouterRestrictedPaths,
      ],
    }),
  ),
  // Sidebar/titlebar/command-menu trees the desktop shell renders outside TabHost.
  // GenerationLayout is split deliberately: Body and Header are portal'd into the
  // sidebar, while the layout root stays in the route tree and owns the url sync.
  restrictImports(
    [
      'src/features/AgentSidebar/**/*.{ts,tsx}',
      'src/features/CommandMenu/**/*.{ts,tsx}',
      'src/features/Electron/titlebar/**/*.{ts,tsx}',
      'src/features/HomeSidebar/**/*.{ts,tsx}',
      'src/features/Pages/PageLayout/Sidebar.{ts,tsx}',
      'src/features/WorkspaceSetting/SideBar/**/*.{ts,tsx}',
      'src/routes/(main)/(create)/features/GenerationLayout/Body/**/*.{ts,tsx}',
      'src/routes/(main)/(create)/features/GenerationLayout/Header/**/*.{ts,tsx}',
    ],
    createRestrictedImportRule({ paths: shellRouterRestrictedPaths }),
  ),
  restrictImports(
    ['src/features/HomeInbox/**/*.{ts,tsx}'],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'Load RunReplyEditor with import() after reply intent so the editor stays outside the home static closure.',
          name: '@/features/AgentTasks/AgentTaskDetail/RunReplyEditor',
        },
        {
          message:
            'HomeInbox must not mount TopicChatDrawer; navigate to the topic or load an interaction-owned surface dynamically.',
          name: '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer',
        },
        {
          message:
            'HomeInbox must not mount TopicChatDrawer; navigate to the topic or load an interaction-owned surface dynamically.',
          name: '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer/index',
        },
        {
          message:
            'Use the imperative DocumentModal loader instead of statically importing the implementation.',
          name: '@/features/DocumentModal',
        },
        {
          message:
            'Use the imperative DocumentModal loader instead of statically importing the implementation.',
          name: '@/features/DocumentModal/index',
        },
      ],
    }),
  ),
  restrictImports(
    [
      'src/features/Home/**/*.{ts,tsx}',
      'src/features/HomeLayout/**/*.{ts,tsx}',
      'src/routes/(main)/home/**/*.{ts,tsx}',
    ],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'Home cold-path modules must use stable Conversation subpaths instead of the root barrel that exports ChatInput.',
          name: '@/features/Conversation',
        },
      ],
      patterns: [
        {
          message:
            'Home cold-path modules must not statically import ChatInput. Load an isolated editor entry with import().',
          // `hooks/useAgentModelSelection` reaches the store only through the
          // editor-free `store/apiContext`; Home model switches share its path.
          regex:
            '^@/features/ChatInput(?:$|/(?!(?:hooks/useAgentModelSelection|store/initialState|utils/contextSelections)$).+)',
        },
      ],
    }),
    ['src/features/Home/InputArea/EditorInput.tsx'],
  ),
  // The home sidebar tree carries both sets of constraints: it is a shell tree
  // rendered outside TabHost, and it is also a home cold path. A later override
  // replaces `eslint-core/no-restricted-imports` rather than merging it, so the
  // shell paths have to be repeated here instead of relying on the shell block above.
  restrictImports(
    ['src/features/HomeSidebar/**/*.{ts,tsx}'],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'Home cold-path modules must use stable Conversation subpaths instead of the root barrel that exports ChatInput.',
          name: '@/features/Conversation',
        },
        ...shellRouterRestrictedPaths,
      ],
      patterns: [
        {
          message:
            'Home cold-path modules must not statically import ChatInput. Load an isolated editor entry with import().',
          regex:
            '^@/features/ChatInput(?:$|/(?!(?:store/initialState|utils/contextSelections)$).+)',
        },
      ],
    }),
    ['src/features/HomeSidebar/hooks/useCreateModal.tsx'],
  ),
  restrictImports(
    ['src/features/Home/InputArea/index.tsx'],
    createRestrictedImportRule({
      paths: [
        {
          message:
            'The home input must load EditorInput through useProgressiveEditor instead of adding it to the route static closure.',
          name: './EditorInput',
        },
      ],
    }),
  ),
  // Global rule overrides
  {
    files: ['**/*'],
    rules: {
      '@eslint-react/jsx-no-key-after-spread': 'off',
      '@eslint-react/naming-convention-ref-name': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/use-state': 'off',
      // There is no Pages Router: ESLint's version only checked pages/ and never fired,
      // while Oxlint's reports every root-relative <a href>.
      'nextjs/no-html-link-for-pages': 'off',
      'nextjs/no-img-element': 'off',
      'no-extra-boolean-cast': 'off',
      // Default exports are allowed here; the preset bans them through this rule.
      'no-restricted-exports': 'off',
      'no-use-before-define': 'off',
      'no-useless-constructor': 'off',
      'react/no-unknown-property': 'off',
      'react/only-export-components': 'off',
      // conflicts with prettier, which lowercases hex literals
      'unicorn/number-literal-case': 'off',
    },
  },
  // TypeScript files - enforce consistent type imports
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'typescript/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
    },
  },
  restrictSyntax(
    ['**/*.{ts,tsx}'],
    [...useRefLazyInitRestrictedSyntax, ...uppercaseRestrictedSyntax],
  ),
  restrictImports(
    ['apps/server/src/**/*.{ts,tsx}'],
    [
      'error',
      {
        ...baseRestrictedImportOptions,
        paths: [...(baseRestrictedImportOptions.paths ?? []), ...serverI18nRestrictedImportPaths],
        patterns: [
          ...(baseRestrictedImportOptions.patterns ?? []),
          ...serverI18nRestrictedImportPatterns,
        ],
      },
    ],
  ),
  // Redis access boundary for server code (see `redisAccessRestrictedImportPaths`).
  // Tests of the legacy consumers import the raw module to mock or seed it;
  // the boundary is about production code paths.
  ...(() => {
    const files = ['apps/server/src/**/*.{ts,tsx}'];
    const excludeFiles = [
      ...legacyRawRedisClientConsumers,
      'apps/server/src/services/redis/**',
      'apps/server/src/modules/Redis/**',
      '**/*.test.{ts,tsx}',
      '**/__tests__/**',
    ];
    return [
      restrictImports(
        files,
        [
          'error',
          {
            ...baseRestrictedImportOptions,
            paths: [
              ...(baseRestrictedImportOptions.paths ?? []),
              ...serverI18nRestrictedImportPaths,
              ...redisAccessRestrictedImportPaths,
            ],
            patterns: [
              ...(baseRestrictedImportOptions.patterns ?? []),
              ...serverI18nRestrictedImportPatterns,
              {
                group: ['@/server/modules/Redis/*'],
                message: 'Use domain methods in services/redis.',
              },
            ],
          },
        ],
        excludeFiles,
      ),
      restrictSyntax(
        files,
        [
          ...useRefLazyInitRestrictedSyntax,
          ...uppercaseRestrictedSyntax,
          ...redisAccessRestrictedSyntax,
        ],
        excludeFiles,
      ),
    ];
  })(),
  restrictSyntax(
    [
      'apps/desktop/src/overlay/**/*.{ts,tsx}',
      'packages/electron-client-ipc/src/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
    ],
    [
      ...useRefLazyInitRestrictedSyntax,
      ...uppercaseRestrictedSyntax,
      electronIpcRemoveListenerRestrictedSyntax,
    ],
    ['src/hooks/usePWAInstall.ts'],
  ),
  // Store/image and types/generation - disable sorting
  {
    files: ['src/store/image/**/*', 'src/types/generation/**/*'],
    rules: {
      'perfectionist/sort-interfaces': 'off',
    },
  },
  // model-bank aiModels - enforce English-only descriptions
  restrictSyntax(
    ['packages/model-bank/src/aiModels/**/*'],
    [
      ...useRefLazyInitRestrictedSyntax,
      ...uppercaseRestrictedSyntax,
      {
        message: 'Chinese characters are not allowed in aiModels files. Use English instead.',
        selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
      },
    ],
  ),
  // E2E and test files - allow console.log for debugging
  {
    files: ['e2e/**/*', '**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-console': 'off' },
  },
  // CLIs and debug utilities - console output is the primary interface
  {
    files: [
      'packages/agent-tracing/**/*',
      'apps/cli/**/*',
      'packages/model-runtime/src/utils/debugStream.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  // Business stubs - keep `use`-prefixed APIs mirroring the cloud implementation,
  // even when the OSS fallback doesn't call any hooks
  {
    files: [
      'src/business/client/features/User/useBusinessMenuItems.tsx',
      'src/business/client/hooks/useBusinessChatInputSendAreaPrefix.tsx',
      'src/business/client/hooks/useBusinessSignup.tsx',
      'src/business/client/hooks/useRenderBusinessBatchItem.tsx',
      'src/business/client/hooks/useRenderBusinessChatErrorMessageExtra.tsx',
      'src/business/client/hooks/useRenderBusinessVideoBatchItem.tsx',
    ],
    rules: { '@eslint-react/no-unnecessary-use-prefix': 'off' },
  },
  ...(stylexMigrationOverrides as UserOverride[]),
  // CommonJS files rely on `require()` by design
  {
    files: ['**/*.cjs', 'apps/desktop/shell/**/*.js'],
    rules: { 'typescript/no-require-imports': 'off' },
  },
);
