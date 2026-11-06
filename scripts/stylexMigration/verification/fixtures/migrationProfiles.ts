import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['TabItem', 'src/features/Electron/titlebar/TabBar/TabItem.tsx'],
  ['ReplicaEntryTable', 'src/features/DevPanel/Replica/EntryTable.tsx'],
] as const;

export const migrationProfiles: Record<string, FixtureProfile> = {
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
  TabItem: {
    assets: ['fixtures/TabItemData.ts'],
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'motion'],
    settleFrames: 2,
    selector: '[data-component-mount] [data-tier]',
    selectors: { 'focus-visible': '[data-component-mount] [data-tab-close]' },
    variants: [
      ...['full', 'full-active', 'compact', 'compact-active', 'full-split', 'full-dragging'].map(
        (id) => ({ id, states: ['default', 'hover', 'focus-visible'] as const }),
      ),
      ...[
        'narrow',
        'icon',
        'pinned',
        'pinned-active',
        'pinned-dragging',
        'full-lone',
        'full-active-dragging',
      ].map((id) => ({ id, states: ['default', 'hover'] as const })),
      {
        id: 'dark-full-active',
        appearance: 'dark' as const,
        states: ['default', 'hover'] as const,
      },
      { id: 'dark-full', appearance: 'dark' as const, states: ['default', 'hover'] as const },
    ],
    boundaries: ['./hooks/useTabPreview', './hooks/useTabRunning', './hooks/useTabUnread'].map(
      (source) => ({
        importer: 'src/features/Electron/titlebar/TabBar/TabItem.tsx',
        source,
        replacement: 'fixtures/TabItemData.ts',
      }),
    ),
  },
  ReplicaEntryTable: {
    assets: ['fixtures/ReplicaEntryTableData.ts'],
    dependencies: ['lucide-react'],
    selector: '[data-component-mount] tbody tr',
    variants: [
      { id: 'rows', states: ['default', 'hover', 'focus-visible'] as const },
      { id: 'selected', states: ['default', 'hover', 'focus-visible'] as const },
      { id: 'dark-selected', appearance: 'dark' as const, states: ['default', 'hover'] as const },
      { id: 'empty' },
    ],
    boundaries: [
      {
        importer: 'src/features/DevPanel/Replica/EntryTable.tsx',
        source: './useReplicaInspector',
        replacement: 'fixtures/ReplicaEntryTableData.ts',
      },
    ],
  },
};
