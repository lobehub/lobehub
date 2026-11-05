import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['GoalWorkspaceBreadcrumb', 'src/features/AgentGoals/GoalWorkspaceBreadcrumb.tsx'],
  ['TaskBreadcrumb', 'src/features/AgentTasks/shared/Breadcrumb.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
] as const;

const goalBreadcrumbData = 'fixtures/GoalBreadcrumbData.ts';
const taskBreadcrumbData = 'fixtures/TaskBreadcrumbData.ts';

export const migrationProfiles: Record<string, FixtureProfile> = {
  GoalWorkspaceBreadcrumb: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'react-router'],
    i18n: true,
    selector: '[data-component-mount] nav a',
    variants: [
      { id: 'normal', states: ['default', 'hover', 'focus-visible'] },
      { id: 'long' },
      { id: 'narrow' },
      { id: 'single' },
      { id: 'narrow-single' },
      { id: 'dark', appearance: 'dark', states: ['default', 'hover'] },
    ],
    boundaries: [
      ...['@/store/user', '@/store/user/selectors'].map((source) => ({
        importer: 'src/features/AgentGoals/GoalWorkspaceBreadcrumb.tsx',
        source,
        replacement: goalBreadcrumbData,
      })),
      {
        importer: 'src/features/Workspace/WorkspaceLink.tsx',
        source: '@/business/client/hooks/useActiveWorkspaceSlug',
        replacement: goalBreadcrumbData,
      },
    ],
  },
  TaskBreadcrumb: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'react-router', 'zustand', 'zod'],
    i18n: true,
    selector: '[data-component-mount] nav a',
    variants: [
      { id: 'task', states: ['default', 'hover', 'focus-visible'] },
      { id: 'long' },
      { id: 'narrow' },
      { id: 'narrow-long' },
      { id: 'root' },
      { id: 'dark', appearance: 'dark', states: ['default', 'hover'] },
    ],
    boundaries: [
      ...['@/store/task', './useAgentDisplayMeta'].map((source) => ({
        importer: 'src/features/AgentTasks/shared/Breadcrumb.tsx',
        source,
        replacement: taskBreadcrumbData,
      })),
      {
        importer: 'src/features/AgentTasks/shared/taskDetailPath.ts',
        source: '@lobechat/utils/taskSlug',
        replacement: taskBreadcrumbData,
      },
      ...[
        'src/features/Workspace/WorkspaceLink.tsx',
        'src/features/Workspace/useWorkspaceAwareNavigate.ts',
      ].map((importer) => ({
        importer,
        source: '@/business/client/hooks/useActiveWorkspaceSlug',
        replacement: taskBreadcrumbData,
      })),
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
