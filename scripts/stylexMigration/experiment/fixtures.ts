export const baselineRef = 'origin/refactor/stylex-foundation';

export const componentSources = {
  CollapsibleContent: [
    'origin/refactor/stylex-components',
    'src/components/CollapsibleContent/index.tsx',
  ],
  CommandLine: ['origin/refactor/stylex-components', 'src/components/CommandLine/index.tsx'],
  DotsLoading: ['origin/refactor/stylex-components', 'src/components/DotsLoading/index.tsx'],
  FilePathDisplay: [
    'origin/refactor/stylex-pkg-apps',
    'packages/shared-tool-ui/src/components/FilePathDisplay.tsx',
  ],
  GalleyGrid: ['origin/refactor/stylex-components', 'src/components/GalleyGrid/Grid.tsx'],
  GeneratingBorder: [
    'origin/refactor/stylex-components',
    'src/components/GeneratingBorder/index.tsx',
  ],
  InlineTable: ['origin/refactor/stylex-components', 'src/components/InlineTable/index.tsx'],
  LiteTable: ['origin/refactor/stylex-components', 'src/components/LiteTable/index.tsx'],
  OptionCard: [
    'origin/refactor/stylex-pkg-apps',
    'packages/shared-tool-ui/src/components/OptionCard.tsx',
  ],
  OptionRow: [
    'origin/refactor/stylex-chatinput-controlbar',
    'src/features/ChatInput/ControlBar/OptionRow.tsx',
  ],
  StatusBar: ['origin/refactor/stylex-components', 'src/components/CodeEditorPane/StatusBar.tsx'],
  TailMarquee: ['origin/refactor/stylex-components', 'src/components/TailMarquee/index.tsx'],
  UnreadDot: ['origin/refactor/stylex-components', 'src/components/UnreadDot/index.tsx'],
  VersionTag: ['origin/refactor/stylex-components', 'src/components/ChangelogModal/VersionTag.tsx'],
} as const;

export type ComponentName = keyof typeof componentSources;

export const fixtures: Array<{ component: ComponentName; id: string; note: string }> = [
  { component: 'CommandLine', id: 'commandLine', note: '普通布局、长文本、第三方复制按钮' },
  { component: 'VersionTag', id: 'versionTag', note: '第三方 Tag 的样式覆盖' },
  { component: 'DotsLoading', id: 'dotsLoading', note: 'CSS 变量、动画、延迟' },
  { component: 'UnreadDot', id: 'unreadDot', note: '动画关键帧、边框 shorthand' },
  {
    component: 'GeneratingBorder',
    id: 'generatingBorder',
    note: '::after、@property、渐变、mask、reduced-motion',
  },
  { component: 'GeneratingBorder', id: 'restingBorder', note: '同一组件的非动画样式分支' },
  { component: 'TailMarquee', id: 'tailMarquee', note: '祖先 focus-visible、hover 媒体条件、溢出' },
  { component: 'LiteTable', id: 'liteTable', note: '600px 容器查询、伪元素、第三方无关的原生表格' },
  { component: 'LiteTable', id: 'wideLiteTable', note: '800px 与 600px 重叠容器查询' },
  { component: 'InlineTable', id: 'inlineTable', note: '第三方表格后代、hover、first/last-child' },
  { component: 'GalleyGrid', id: 'galleyGrid', note: 'Grid、后代规则、CSS 变量' },
  { component: 'OptionRow', id: 'optionRow', note: 'hover、active、disabled 样式分支' },
  { component: 'OptionCard', id: 'optionCard', note: 'selected、highlighted、hover 优先级' },
  { component: 'FilePathDisplay', id: 'filePathDisplay', note: '共享包样式、SVG 图标、文本' },
  { component: 'StatusBar', id: 'statusBar', note: '按钮 hover、颜色继承、样式 shorthand' },
  { component: 'CollapsibleContent', id: 'collapsibleContent', note: 'mask、动态尺寸、按钮 hover' },
];
