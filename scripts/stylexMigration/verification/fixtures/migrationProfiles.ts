import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['ShareTextExport', 'src/features/ShareModal/ShareText/index.tsx'],
  ['SideBarHeaderLayout', 'src/features/NavPanel/SideBarHeaderLayout.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
] as const;

export const migrationProfiles: Record<string, FixtureProfile> = {
  ShareTextExport: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    i18n: true,
    selector: '[data-component-mount] button',
    variants: [{ id: 'default', states: ['default', 'hover', 'focus-visible'] }],
    boundaries: [
      '../ShareDataProvider',
      '../useExportMessages',
      './template',
      '@lobechat/utils/client',
      '@lobechat/utils/format',
    ].map((source) => ({
      importer: 'src/features/ShareModal/ShareText/index.tsx',
      replacement: 'fixtures/ShareFixtureData.ts',
      source,
    })),
  },
  SideBarHeaderLayout: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    i18n: true,
    selector: '[data-component-mount] a',
    variants: ['breadcrumb', 'breadcrumb-outside', 'back', 'back-outside'].map((id) => ({
      id,
      states: ['default', 'hover', 'focus-visible'],
    })),
    boundaries: [
      {
        importer: 'src/features/NavPanel/SideBarHeaderLayout.tsx',
        source: '@/features/Workspace/useWorkspaceAwareNavigate',
      },
      ...[
        '@/store/global',
        '@/store/global/selectors',
        '@/store/user',
        '@/store/user/selectors',
        '@/utils/platform',
      ].map((source) => ({ importer: 'src/features/NavPanel/ToggleLeftPanelButton.tsx', source })),
      ...[
        '@/business/client/hooks/useActiveWorkspaceSlug',
        '@/features/Electron/navigation/appNavigate',
        '@/features/Workspace/workspaceAwarePath',
      ].map((source) => ({ importer: 'src/features/NavPanel/components/BackButton.tsx', source })),
    ].map((boundary) => ({ ...boundary, replacement: 'fixtures/NavPanelFixtureData.ts' })),
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
