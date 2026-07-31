import { fileURLToPath } from 'node:url';

import { eslint } from '@lobehub/lint';
import { restrictedImports } from '@lobehub/ui/eslint';
import { flat as mdxFlat } from 'eslint-plugin-mdx';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

const baseRestrictedImportOptions = restrictedImports.rules['no-restricted-imports'][1];

const performanceRestrictedImportPaths = [
  {
    message:
      'Import the imperative facade from "@/features/ShareModal" so the modal implementation stays outside initial chunks.',
    name: '@/features/ShareModal/Modal',
  },
];

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

const createRestrictedImportRule = ({ paths = [], patterns } = {}) => [
  'error',
  {
    ...baseRestrictedImportOptions,
    paths: [
      ...(baseRestrictedImportOptions.paths ?? []),
      ...performanceRestrictedImportPaths,
      ...paths,
    ],
    ...(patterns?.length
      ? { patterns: [...(baseRestrictedImportOptions.patterns ?? []), ...patterns] }
      : {}),
  },
];

export default eslint(
  {
    ignores: [
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
    ],
    next: true,
    react: 'next',
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
      },
    },
  },
  restrictedImports,
  // Performance import boundaries. These restrictions preserve real import()
  // seams instead of relying on component-level conditional rendering.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': createRestrictedImportRule(),
    },
  },
  {
    files: ['src/features/Conversation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
        paths: [
          {
            message:
              'Conversation internals must use stable subpaths such as "./store", "./ConversationProvider", or "./Messages" instead of the root barrel.',
            name: '@/features/Conversation',
          },
        ],
      }),
    },
  },
  {
    files: ['src/features/NavPanel/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
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
    },
  },
  {
    files: [
      'src/routes/**/_layout/Sidebar.{ts,tsx}',
      'src/routes/**/_layout/Sidebar/**/*.{ts,tsx}',
      'src/routes/**/_layout/SideBar.{ts,tsx}',
      'src/routes/**/_layout/SideBar/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
        paths: [
          {
            message:
              'Route Sidebars must import NavPanelPortal from its dedicated subpath instead of the NavPanel host barrel.',
            name: '@/features/NavPanel',
          },
          ...shellRouterRestrictedPaths,
        ],
      }),
    },
  },
  {
    // Sidebar/titlebar/command-menu trees the desktop shell renders outside TabHost.
    // GenerationLayout is split deliberately: Body and Header are portal'd into the
    // sidebar, while the layout root stays in the route tree and owns the url sync.
    files: [
      'src/features/AgentSidebar/**/*.{ts,tsx}',
      'src/features/CommandMenu/**/*.{ts,tsx}',
      'src/features/Electron/titlebar/**/*.{ts,tsx}',
      'src/features/HomeSidebar/**/*.{ts,tsx}',
      'src/features/Pages/PageLayout/Sidebar.{ts,tsx}',
      'src/features/WorkspaceSetting/SideBar/**/*.{ts,tsx}',
      'src/routes/(main)/(create)/features/GenerationLayout/Body/**/*.{ts,tsx}',
      'src/routes/(main)/(create)/features/GenerationLayout/Header/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
        paths: shellRouterRestrictedPaths,
      }),
    },
  },
  {
    files: ['src/features/HomeInbox/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
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
    },
  },
  {
    files: ['src/features/Home/**/*.{ts,tsx}', 'src/routes/(main)/home/**/*.{ts,tsx}'],
    ignores: [
      'src/routes/(main)/home/_layout/hooks/useCreateModal.tsx',
      'src/features/Home/InputArea/EditorInput.tsx',
    ],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
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
            regex:
              '^@/features/ChatInput(?:$|/(?!(?:store/initialState|utils/contextSelections)$).+)',
          },
        ],
      }),
    },
  },
  {
    files: ['src/features/Home/InputArea/index.tsx'],
    rules: {
      'no-restricted-imports': createRestrictedImportRule({
        paths: [
          {
            message:
              'The home input must load EditorInput through useProgressiveEditor instead of adding it to the route static closure.',
            name: './EditorInput',
          },
        ],
      }),
    },
  },
  // Global rule overrides
  {
    rules: {
      '@eslint-react/hooks-extra/no-direct-set-state-in-use-effect': 0,
      '@eslint-react/jsx-key-before-spread': 0,
      '@eslint-react/naming-convention/ref-name': 0,
      '@eslint-react/naming-convention/use-state': 0,
      '@eslint-react/no-array-index-key': 0,
      '@next/next/no-img-element': 0,
      '@typescript-eslint/no-use-before-define': 0,
      '@typescript-eslint/no-useless-constructor': 0,
      'no-extra-boolean-cast': 0,
      'no-restricted-syntax': 0,
      'react-refresh/only-export-components': 0,
      'react/no-unknown-property': 0,
      'regexp/match-any': 0,
      'unicorn/better-regex': 0,
    },
  },
  // TypeScript files - enforce consistent type imports
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        2,
        {
          fixStyle: 'separate-type-imports',
        },
      ],
    },
  },
  // MDX files
  {
    ...mdxFlat,
    files: ['**/*.mdx'],
    rules: {
      ...mdxFlat.rules,
      '@typescript-eslint/consistent-type-imports': 0,
      '@typescript-eslint/no-unused-vars': 1,
      'mdx/remark': 0,
      'no-undef': 0,
      'react/jsx-no-undef': 0,
      'react/no-unescaped-entities': 0,
    },
  },
  // Store/image and types/generation - disable sorting
  {
    files: ['src/store/image/**/*', 'src/types/generation/**/*'],
    rules: {
      'perfectionist/sort-interfaces': 0,
      'perfectionist/sort-object-types': 0,
      'perfectionist/sort-objects': 0,
    },
  },
  // model-bank aiModels - enforce English-only descriptions
  {
    files: ['packages/model-bank/src/aiModels/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          message: 'Chinese characters are not allowed in aiModels files. Use English instead.',
          selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
        },
      ],
    },
  },
  // CLI scripts
  {
    files: ['scripts/**/*'],
    rules: {
      'unicorn/no-process-exit': 0,
      'unicorn/prefer-top-level-await': 0,
    },
  },
  // E2E and test files - allow console.log for debugging
  {
    files: ['e2e/**/*', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-console': 0,
    },
  },
  // agent-tracing CLI - console output is the primary interface
  {
    files: ['packages/agent-tracing/**/*'],
    rules: {
      'no-console': 0,
    },
  },
  // lobehub-cli - console output is the primary interface
  {
    files: ['apps/cli/**/*'],
    rules: {
      'no-console': 0,
    },
  },
  // model-runtime debug utilities - console output is the primary interface
  {
    files: ['packages/model-runtime/src/utils/debugStream.ts'],
    rules: {
      'no-console': 0,
    },
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
    rules: {
      '@eslint-react/no-unnecessary-use-prefix': 0,
    },
  },
  // CommonJS files rely on `require()` by design
  {
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 0,
    },
  },
);
