declare module 'verification:component' {
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
  export const Menu: ComponentType<import('@lobehub/ui').ListProps>;
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
