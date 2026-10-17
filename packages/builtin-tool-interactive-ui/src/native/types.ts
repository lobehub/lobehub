/** Declarative host-native UI. No source code, HTML, style strings, or external capabilities. */
export type NativeUIValue = boolean | number | string;
export type NativeUIState = Record<string, NativeUIValue>;
export type NativeUIOperation =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'min'
  | 'max'
  | 'round'
  | 'equal'
  | 'less'
  | 'greater'
  | 'if'
  | 'concat'
  | 'format';

export type NativeUIExpression =
  NativeUIValue | { ref: string } | { args: NativeUIExpression[]; op: NativeUIOperation };

export type NativeUIStateDefinition =
  | { initial: number; max: number; min: number; step?: number; type: 'number' }
  | { initial: string; options?: string[]; type: 'string' }
  | { initial: boolean; type: 'boolean' };

interface NativeUINodeBase {
  id: string;
  visible?: NativeUIExpression;
}

export type NativeUIGap = 'small' | 'medium' | 'large';
export interface NativeUIStackNode extends NativeUINodeBase {
  children: NativeUINode[];
  gap?: NativeUIGap;
  type: 'stack';
}
export interface NativeUIGridNode extends NativeUINodeBase {
  children: NativeUINode[];
  columns: 1 | 2 | 3 | 4;
  gap?: NativeUIGap;
  type: 'grid';
}
export interface NativeUITextNode extends NativeUINodeBase {
  content: NativeUIExpression;
  tone?: 'default' | 'secondary';
  type: 'text';
  variant?: 'heading' | 'body' | 'caption';
}
export interface NativeUIMetricNode extends NativeUINodeBase {
  detail?: NativeUIExpression;
  label: string;
  type: 'metric';
  value: NativeUIExpression;
}
export interface NativeUINumberNode extends NativeUINodeBase {
  bind: string;
  description?: string;
  label: string;
  type: 'slider' | 'number';
  unit?: string;
}
export interface NativeUIOption {
  badge?: NativeUIExpression;
  description?: NativeUIExpression;
  label: string;
  value: NativeUIValue;
  valueLabel?: NativeUIExpression;
}
export interface NativeUIChoiceNode extends NativeUINodeBase {
  bind: string;
  description?: string;
  label: string;
  options: NativeUIOption[];
  type: 'select' | 'choices';
}
export interface NativeUIChartSeries {
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'cyan';
  id: string;
  label: string;
  y: NativeUIExpression;
}
export interface NativeUIChartNode extends NativeUINodeBase {
  chartType: 'line' | 'bar' | 'area';
  currentX?: NativeUIExpression;
  description?: string;
  series: NativeUIChartSeries[];
  title?: string;
  type: 'chart';
  x: { label?: string; max: number; min: number; samples: number };
  yLabel?: string;
}
export interface NativeUIActionNode extends NativeUINodeBase {
  action: 'propose';
  label: string;
  text: NativeUIExpression;
  type: 'action';
}
export type NativeUINode =
  | NativeUIStackNode
  | NativeUIGridNode
  | NativeUITextNode
  | NativeUIMetricNode
  | NativeUINumberNode
  | NativeUIChoiceNode
  | NativeUIChartNode
  | NativeUIActionNode;

export interface NativeUIDocument {
  body: NativeUINode[];
  derived: Record<string, NativeUIExpression>;
  fallback: string;
  state: Record<string, NativeUIStateDefinition>;
  title: string;
  version: 2;
}

export interface NativeUIChartData {
  currentValues: Record<string, number | null>;
  currentX: number | null;
  data: Array<{ [seriesId: string]: number | null; x: number }>;
}
