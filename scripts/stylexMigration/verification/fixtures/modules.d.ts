declare module 'verification:component' {
  import type { AskUserQuestionViewProps } from '@lobechat/shared-tool-ui/ask-user';
  import type { WorkSummaryItem } from '@lobechat/types';
  import type { ListProps } from '@lobehub/ui';
  import type { LucideIcon } from 'lucide-react';
  import type { ComponentType, CSSProperties, ReactNode } from 'react';

  interface Row {
    id: string;
    name: string;
    status: string;
  }
  interface Props {
    columns: Array<{
      key: string;
      listSlot?: 'title' | 'actions';
      render: (row: Row) => ReactNode;
      title: string;
    }>;
    dataSource: Row[];
    emptyText: ReactNode;
    listBreakpoint: 600 | 800;
    loading: boolean;
    onRowClick: () => void;
    rowKey: (row: Row) => string;
    tableLayout: 'auto' | 'fixed';
  }
  export const LiteTable: ComponentType<Props>;
  export const WorkPreview: ComponentType<{
    item: WorkSummaryItem;
    title: string;
  }>;
  export const WorkPreviewStatus: typeof WorkPreview;
  export const PreviewToolbar: ComponentType<{
    actions?: ReactNode;
    path: string;
    rootPath?: string;
  }>;
  export const ToolbarActionButton: ComponentType<{
    active?: boolean;
    disabled?: boolean;
    icon: LucideIcon;
    label?: ReactNode;
    loading?: boolean;
  }>;
  export const SidebarGroupItem: ComponentType<{ disabled: boolean; id: string; name: string }>;
  export const Menu: ComponentType<ListProps>;
  export const SpendType: ComponentType<{
    children: ReactNode;
    type:
      | 'chat'
      | 'embedding'
      | 'imageGeneration'
      | 'speechRecognition'
      | 'textToSpeech'
      | 'videoGeneration';
  }>;
  export const CommandLine: ComponentType<{ command: string }>;
  export const DotsLoading: ComponentType<{ color?: string; gap?: number; size?: number }>;
  export const UnreadDot: ComponentType<{ label?: string }>;
  export const VersionTag: ComponentType<{ range: string[] }>;
  export const GeneratingBorder: ComponentType<{ children: ReactNode; generating: boolean }>;
  export const GalleyGrid: ComponentType<{
    children: ReactNode;
    col: number;
    gap: number;
    max: number;
  }>;
  export const TailMarquee: ComponentType<{ children: ReactNode; style?: CSSProperties }>;
  export const CollapsibleContent: ComponentType<{
    children: ReactNode;
    collapsed: boolean;
    maxHeight: number;
    onCollapsedChange: () => void;
  }>;
  export const InlineTable: ComponentType<{
    columns: Array<{ dataIndex: string; key: string; title: string }>;
    dataSource: Row[];
    hoverToActive: boolean;
    rowKey: string;
  }>;
  export const StatusBar: ComponentType<{
    cursor: { column: number; line: number; selectionLength: number };
    indent: { size: number; useTabs: boolean };
    languageLabel: string;
    lineWrapping: boolean;
    readOnly: boolean;
    onLineWrappingChange: () => void;
  }>;
  export const FilePathDisplay: ComponentType<{ filePath: string; isDirectory: boolean }>;
  export const AskUserQuestionView: ComponentType<AskUserQuestionViewProps>;
  export const OptionCard: ComponentType<{
    description: string;
    disabled: boolean;
    highlighted: boolean;
    index: number;
    label: string;
    recommendedText: string;
    selected: boolean;
    onToggle: () => void;
  }>;
  export const VoiceMessageControl: ComponentType<{
    actionLabel: string;
    actionText?: string;
    cancelLabel: string;
    durationLabel: string;
    errorText?: string;
    expanded?: boolean;
    groupLabel: string;
    isRetry?: boolean;
    onAction: () => void;
    onCancel: () => void;
    progress?: number;
    sendDisabled?: boolean;
    statusAnnouncement: string;
    tooltip?: string;
    waveform: number[];
  }>;
  export const OptionRow: ComponentType<{
    active: boolean;
    desc: string;
    disabled: boolean;
    extra: ReactNode;
    icon: ReactNode;
    label: string;
    tag: string;
    onClick: () => void;
  }>;
  export const AcceptanceReport: ComponentType<{ runId?: string }>;
  export const AcceptanceEvidenceList: ComponentType<{ evidence: unknown[] }>;
}

declare module 'verification:locale/chat' {
  const value: Record<string, string>;
  export default value;
}
declare module 'verification:locale/components' {
  const value: Record<string, string>;
  export default value;
}
declare module '*.css';
