import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['AgentCard', 'src/features/AgentViewAll/AgentCard.tsx'],
  [
    'MultipleProvidersModelItem',
    'src/features/ModelSwitchPanel/components/List/MultipleProvidersModelItem.tsx',
  ],
  ['MCPConfigForm', 'src/features/MCP/MCPInstallProgress/MCPConfigForm.tsx'],
  ['ModelSelect', 'src/features/ModelSelect/index.tsx'],
  ['RulesOnboarding', 'src/features/MemoryRules/RulesOnboarding.tsx'],
  ['TopicCard', 'src/features/AgentTopicManager/TopicCard.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
] as const;

export const migrationProfiles: Record<string, FixtureProfile> = {
  AgentCard: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'react-router', 'zod'],
    selector: '[data-component-mount] a',
    settleFrames: 2,
    variants: [
      { id: 'light', states: ['default', 'hover', 'focus-visible'] },
      { id: 'dark', appearance: 'dark', states: ['default', 'hover'] },
    ],
    boundaries: [
      {
        importer: 'src/features/AgentViewAll/AgentCard.tsx',
        source: './ItemActions',
        replacement: 'fixtures/AgentCardFixtureStubs.tsx',
      },
      {
        importer: 'src/features/AgentViewAll/SidebarItemAvatar.tsx',
        source: '@/features/AgentGroupAvatar',
        replacement: 'fixtures/AgentGroupAvatarStub.tsx',
      },
      {
        importer: 'src/features/AgentViewAll/resolveAgentBadge.ts',
        source: '@lobechat/builtin-agents',
        replacement: 'fixtures/AgentCardFixtureData.ts',
      },
      ...['src/features/AgentViewAll/AgentCard.tsx', 'src/components/AgentAvatar/resolve.ts'].map(
        (importer) => ({
          importer,
          source: '@lobechat/const',
          replacement: 'fixtures/AgentCardFixtureData.ts',
        }),
      ),
    ],
  },
  MCPConfigForm: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'motion', 'fast-deep-equal'],
    variants: [{ id: 'light' }, { id: 'dark', appearance: 'dark' }],
    boundaries: [
      ['src/features/MCP/MCPInstallProgress/MCPConfigForm.tsx', '@/store/tool'],
      ['src/features/PluginSettings/index.tsx', '@/store/tool'],
      ['src/features/PluginSettings/index.tsx', '@/store/tool/selectors'],
    ].map(([importer, source]) => ({
      importer,
      source,
      replacement: 'fixtures/MCPConfigFormFixtureData.ts',
    })),
  },
  ModelSelect: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', '@lobehub/icons', 'numeral'],
    i18n: true,
    settleFrames: 2,
    variants: ['closed-normal', 'closed-stale', 'open-normal', 'open-stale', 'open-redirected'].map(
      (id) => ({ id }),
    ),
    boundaries: [
      {
        importer: 'src/features/ModelSelect/index.tsx',
        source: '@/store/aiInfra',
        replacement: 'fixtures/ModelSelectFixtureData.ts',
      },
      {
        importer: 'src/components/ModelSelect/index.tsx',
        source: '@/utils/format',
        replacement: 'fixtures/ModelSelectFixtureData.ts',
      },
      {
        importer: 'src/components/ModelSelect/NewModelBadge.tsx',
        source: '@/utils/time',
        replacement: 'fixtures/ModelSelectFixtureData.ts',
      },
    ],
  },
  MultipleProvidersModelItem: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    exportName: 'MultipleProvidersModelItem',
    i18n: true,
    settleFrames: 2,
    variants: [{ id: 'normal' }, { id: 'active' }, { id: 'restricted' }],
    boundaries: [
      ['../../utils', '../ModelDetailPanel', './ModelRowRender', '@/components/ModelSelect'].map(
        (source) => ({
          importer: 'src/features/ModelSwitchPanel/components/List/MultipleProvidersModelItem.tsx',
          source,
          replacement: 'fixtures/ModelSwitchPanelFixtureData.tsx',
        }),
      ),
    ].flat(),
  },
  RulesOnboarding: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next', 'react-router'],
    selector: '[data-component-mount] button',
    variants: [
      { id: 'full', states: ['default', 'hover', 'focus-visible'] },
      { id: 'inline' },
      { id: 'minimal' },
      { id: 'dark', appearance: 'dark' },
    ],
  },
  TopicCard: {
    dependencies: [
      'lucide-react',
      'i18next',
      'react-i18next',
      'react-router',
      'dayjs',
      'zustand',
      'zod',
    ],
    variants: [{ id: 'light' }, { id: 'dark', appearance: 'dark' }],
    boundaries: [
      ['src/features/AgentTopicManager/TopicCard.tsx', '@lobechat/utils/format'],
      ['src/features/AgentTopicManager/TopicCard.tsx', './utils'],
      ['src/hooks/useActivityTime.ts', '@lobechat/utils/time'],
      ['src/features/AgentTopicManager/TopicCard.tsx', '@lobechat/const'],
    ].map(([importer, source]) => ({
      importer,
      source,
      replacement: 'fixtures/TopicCardFixtureData.ts',
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
