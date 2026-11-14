import type { FixtureProfile } from './fixtureRegistry';

export const migrationFixtures = [
  ['AskUserQuestionView', 'packages/shared-tool-ui/src/AskUserQuestion/AskUserQuestionView.tsx'],
  ['SidebarGroupItem', 'src/features/HomeSidebar/Body/Agent/Modals/ConfigGroupModal/GroupItem.tsx'],
  ['ToolbarActionButton', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['PreviewToolbar', 'src/features/Portal/LocalFile/PreviewToolbar.tsx'],
  ['WorkPreview', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['WorkPreviewStatus', 'src/features/WorkGallery/WorkPreview.tsx'],
  ['AcceptanceReport', 'src/features/Acceptance/Report/ReportViewer.tsx'],
  ['AcceptanceEvidenceList', 'src/features/Acceptance/Viewer/Evidence/EvidenceList.tsx'],
  ['VoiceMessageControl', 'src/features/ChatInput/VoiceMessage/index.tsx'],
] as const;

const voiceMessageImporter = 'src/features/ChatInput/VoiceMessage/index.tsx';
const voiceMessageData = 'fixtures/VoiceMessageFixtureData.ts';

export const migrationProfiles: Record<string, FixtureProfile> = {
  AskUserQuestionView: {
    dependencies: ['lucide-react', 'path-browserify-esm'],
    exportName: 'AskUserQuestionView',
    selector: '[data-component-mount] [role="tab"]',
    settleFrames: 2,
    variants: [
      { id: 'questions', states: ['default', 'hover', 'focus-visible'] },
      { id: 'escape' },
      { id: 'dark-questions', appearance: 'dark' },
    ],
  },
  VoiceMessageControl: {
    dependencies: ['lucide-react', 'i18next', 'react-i18next'],
    exportName: 'VoiceMessageControl',
    selector: '[data-component-mount] [data-testid="voice-message-pill"] button',
    settleFrames: 2,
    variants: [
      { id: 'recording', states: ['default', 'hover', 'focus-visible'] },
      { id: 'busy' },
      { id: 'retry', states: ['default', 'hover', 'focus-visible'] },
      { id: 'hover-expanded' },
      { id: 'retry-hover-expanded' },
      { id: 'disabled', states: ['default', 'hover'] },
      { id: 'progress' },
      { id: 'dark-recording', appearance: 'dark', states: ['default', 'focus-visible'] },
    ],
    boundaries: [
      '../ActionBar/components/ChatInputAction',
      '../hooks/useAgentId',
      '../hooks/useEffectiveModel',
      '../store',
      './useVoiceMessageCapability',
      './useVoiceMessageRecorder',
    ].map((source) => ({ importer: voiceMessageImporter, source, replacement: voiceMessageData })),
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
  AcceptanceReport: {
    dependencies: [
      'lucide-react',
      'i18next',
      'react-i18next',
      'react-router',
      'path-browserify-esm',
      'es-toolkit',
    ],
    settleFrames: 2,
    variants: [
      { id: 'horizontal' },
      { id: 'vertical' },
      { id: 'dark-horizontal', appearance: 'dark' },
    ],
    boundaries: [
      { importer: 'src/features/Acceptance/Report/ReportViewer.tsx', source: '../hooks' },
      { importer: 'src/features/Acceptance/Report/ReportViewer.tsx', source: './TerminalEvidence' },
      {
        importer: 'src/features/Acceptance/Report/MarkdownEvidence.tsx',
        source: '@/features/FileViewer/hooks/useTextFileLoader',
      },
    ].map((boundary) => ({ ...boundary, replacement: 'fixtures/AcceptanceReportData.ts' })),
  },
  AcceptanceEvidenceList: {
    assets: ['fixtures/AcceptanceEvidenceData.ts'],
    dependencies: [
      'lucide-react',
      'i18next',
      'react-i18next',
      'react-router',
      'path-browserify-esm',
      'es-toolkit',
    ],
    exportName: 'EvidenceList',
    settleFrames: 2,
    variants: [
      { id: 'screenshot' },
      { id: 'tall' },
      { id: 'unsized' },
      { id: 'gif' },
      { id: 'video' },
      { id: 'dark-screenshot', appearance: 'dark' },
    ],
    boundaries: [
      {
        importer: 'src/features/Acceptance/Viewer/Evidence/EvidenceList.tsx',
        source: '../../Report/TerminalEvidence',
      },
      {
        importer: 'src/features/Acceptance/Report/MarkdownEvidence.tsx',
        source: '@/features/FileViewer/hooks/useTextFileLoader',
      },
      {
        importer: 'src/features/Acceptance/Viewer/AcceptanceScope.tsx',
        source: './useAcceptanceBundle',
      },
    ].map((boundary) => ({ ...boundary, replacement: 'fixtures/AcceptanceEvidenceData.ts' })),
  },
};
