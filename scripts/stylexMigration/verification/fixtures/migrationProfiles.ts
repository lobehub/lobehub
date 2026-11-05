import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['CommandMenuTheme', 'src/features/CommandMenu/ThemeMenu.tsx'],
  ['DashboardLayoutEditor', 'src/features/Dashboard/Board/LayoutEditor.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
] as const;

const commandMenuData = 'fixtures/CommandMenuFixtureData.tsx';
const dashboardData = 'fixtures/DashboardFixtureData.tsx';

export const migrationProfiles: Record<string, FixtureProfile> = {
  CommandMenuTheme: {
    dependencies: ['cmdk', 'lucide-react', 'i18next', 'react-i18next'],
    selector: '[data-component-mount] [cmdk-item][data-value="theme-dark"]',
    selectors: {
      'hover': '[data-component-mount] [cmdk-item][data-value="theme-dark"]',
      'focus-visible': '[data-component-mount] [cmdk-input]',
    },
    variants: [
      { id: 'light', states: ['default', 'hover', 'focus-visible'] },
      { id: 'dark', appearance: 'dark', states: ['default', 'hover'] },
    ],
    boundaries: [
      ...['./useCommandMenu', 'next-themes'].map((source) => ({
        importer: 'src/features/CommandMenu/ThemeMenu.tsx',
        source,
        replacement: commandMenuData,
      })),
      ...[
        '@lobechat/types',
        '@/components/AgentAvatar',
        '@/store/agent',
        '@/store/agent/selectors',
        '../CommandMenuContext',
        '../useCommandMenu',
      ].map((source) => ({
        importer: 'src/features/CommandMenu/components/CommandInput.tsx',
        source,
        replacement: commandMenuData,
      })),
    ],
  },
  DashboardLayoutEditor: {
    dependencies: [
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'lucide-react',
      'i18next',
      'react-i18next',
    ],
    selector: '[data-component-mount] [data-layout-cell="a"]',
    selectors: {
      'hover': '[data-component-mount] [data-layout-cell="a"]',
      'focus-visible': '[data-component-mount] [data-layout-cell="a"] [data-resize-handle]',
    },
    variants: [
      { id: 'light', states: ['default', 'hover', 'focus-visible'] },
      { id: 'dark', appearance: 'dark', states: ['default', 'hover'] },
    ],
    boundaries: [
      '@/store/dashboard',
      '@/store/user',
      '@/store/user/selectors',
      '../WidgetCard',
      '../WidgetEditModal',
    ].map((source) => ({
      importer: 'src/features/Dashboard/Board/LayoutEditor.tsx',
      source,
      replacement: dashboardData,
    })),
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
