import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['EvalCaptureContent', 'src/features/EvalCapture/CaptureContent.tsx'],
  [
    'EvalRunCreateFooter',
    'src/routes/(main)/eval/bench/[benchmarkId]/features/RunCreateModal/Footer.tsx',
  ],
  [
    'EvalTestCaseTable',
    'src/routes/(main)/eval/bench/[benchmarkId]/features/DatasetsTab/TestCaseTable.tsx',
  ],
  ['EvalTestCaseDetail', 'src/routes/(main)/eval/features/TestCaseDetail/index.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
] as const;

const evalData = 'fixtures/EvalFixtureData.ts';

export const migrationProfiles: Record<string, FixtureProfile> = {
  EvalCaptureContent: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    selector: '[data-component-mount] [data-segmented-item]',
    settleFrames: 2,
    variants: [
      { id: 'normal', states: ['default', 'hover', 'focus-visible'] },
      { id: 'dark', appearance: 'dark' },
    ],
    boundaries: [
      {
        importer: 'src/features/EvalCapture/CaptureContent.tsx',
        source: '@/services/agentEval',
        replacement: evalData,
      },
    ],
  },
  EvalRunCreateFooter: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    selector: '[data-component-mount] button[aria-haspopup]',
    variants: [
      { id: 'normal', states: ['default', 'hover', 'focus-visible'] },
      { id: 'loading' },
      { id: 'dark', appearance: 'dark' },
    ],
  },
  EvalTestCaseTable: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    selector: '[data-component-mount] tbody tr',
    variants: [
      { id: 'selected', states: ['default', 'hover'] },
      { id: 'unselected', states: ['default', 'hover'] },
      { id: 'readonly' },
      { id: 'dark-selected', appearance: 'dark', states: ['default', 'hover'] },
    ],
  },
  EvalTestCaseDetail: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'react-router'],
    selector: '[data-component-mount] nav a',
    settleFrames: 2,
    variants: [
      { id: 'view', states: ['default', 'hover', 'focus-visible'] },
      { id: 'editing' },
      { id: 'dark-editing', appearance: 'dark' },
    ],
    boundaries: [
      {
        importer: 'src/routes/(main)/eval/features/TestCaseDetail/index.tsx',
        source: '@/store/eval',
        replacement: evalData,
      },
      {
        importer: 'src/features/Workspace/WorkspaceLink.tsx',
        source: '@/business/client/hooks/useActiveWorkspaceSlug',
        replacement: evalData,
      },
    ],
  },
  SidebarGroupItem: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    i18n: true,
    variants: ['disabled', 'long', 'hidden'].map((id) => ({ id })),
    boundaries: ['@/store/home', '../../useSidebarGroupVisibility'].map((source) => ({
      importer: 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx',
      source,
      replacement: 'fixtures/FixtureBusinessData.ts',
    })),
  },
  ToolbarActionButton: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    exportName: 'ToolbarActionButton',
    selector: '[data-component-mount] button',
    variants: ['normal', 'active', 'disabled', 'loading', 'narrow', 'boundary'].map((id) => ({
      id,
      states:
        id === 'disabled' || id === 'loading'
          ? ['default', 'hover']
          : ['default', 'hover', 'focus-visible'],
    })),
    boundaries: [
      {
        importer: 'src/features/Portal/LocalFile/PreviewToolbar.tsx',
        source: './PathBreadcrumb',
        replacement: 'fixtures/UnmountedBreadcrumb.tsx',
      },
    ],
  },
  PreviewToolbar: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    variants: [
      { id: 'actions' },
      { id: 'no-actions' },
      { id: 'hidden-actions' },
      { id: 'dark-actions', appearance: 'dark' },
    ],
    boundaries: [
      { source: '@/store/chat', replacement: 'fixtures/FixtureBusinessData.ts' },
      {
        source: '@/features/Conversation/WorkingSidebar/Files/useProjectFiles',
        replacement: 'fixtures/FixtureBusinessData.ts',
      },
    ].map((boundary) => ({
      ...boundary,
      importer: 'src/features/Portal/LocalFile/PathBreadcrumb.tsx',
    })),
  },
  WorkPreview: {
    assets: ['fixtures/WorkPreviewData.ts'],
    dependencies: [
      'lucide-react',
      '@lobehub/icons',
      'i18next',
      'react-i18next',
      'zod',
      'path-browserify-esm',
    ],
    variants: [
      'document',
      'canvas',
      'file',
      'task-todo',
      'task-completed',
      'github',
      'linear',
    ].flatMap((kind) =>
      (['light', 'dark'] as const).map((appearance) => ({
        id: `${kind}-${appearance}`,
        appearance,
      })),
    ),
  },
  WorkPreviewStatus: {
    assets: ['fixtures/WorkPreviewData.ts'],
    dependencies: [
      'lucide-react',
      '@lobehub/icons',
      'i18next',
      'react-i18next',
      'zod',
      'path-browserify-esm',
    ],
    variants: ['warning', 'info'].flatMap((kind) =>
      (['light', 'dark'] as const).map((appearance) => ({
        id: `${kind}-${appearance}`,
        appearance,
      })),
    ),
  },
};
