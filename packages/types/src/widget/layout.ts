// ============================================
// Widget layout — a declarative card template
// ============================================
//
// A widget script reports data; `WidgetView.layout` decides how that data
// looks. The layout is a small JSON tree of fixed primitives whose values bind
// to the output by path, so the agent (or a preset) can design a rich card
// without shipping code to the browser, and the card follows the app theme.

export type WidgetLayoutLiteral = string | number | boolean | null;

/**
 * How a bound value is printed:
 *
 * - `number` — locale grouping, `digits` fraction digits (default up to 2)
 * - `compact` — 1.2K / 3.4M
 * - `percent` — a 0–1 ratio as 42%
 * - `date` / `time` / `datetime` / `weekday` — an ISO timestamp, or `pattern`
 *   (dayjs) for anything else
 * - `relative` — "3 hours ago"
 */
export const WIDGET_LAYOUT_FORMATS = [
  'number',
  'compact',
  'percent',
  'date',
  'time',
  'datetime',
  'weekday',
  'relative',
] as const;
export type WidgetLayoutFormat = (typeof WIDGET_LAYOUT_FORMATS)[number];

/**
 * Read a value from the scope by path: `data.temp`, `data.hourly.0.temp`,
 * `item.t` inside a `repeat`. `map` translates the raw value (e.g. a weather
 * code to an icon name), `fallback` stands in when the path is missing.
 */
export interface WidgetLayoutBinding {
  bind: string;
  digits?: number;
  fallback?: WidgetLayoutLiteral;
  format?: WidgetLayoutFormat;
  map?: Record<string, WidgetLayoutLiteral>;
  /** dayjs pattern for date-like formats, e.g. 'HH:mm'. */
  pattern?: string;
}

/** A string with `{path}` placeholders, e.g. "H {data.hi}° · L {data.lo}°". */
export interface WidgetLayoutTemplate {
  template: string;
}

export type WidgetLayoutValue = WidgetLayoutLiteral | WidgetLayoutBinding | WidgetLayoutTemplate;

/** Show a node only when the bound value passes every given comparison. */
export interface WidgetLayoutCondition {
  bind: string;
  eq?: WidgetLayoutLiteral;
  exists?: boolean;
  gt?: number;
  gte?: number;
  in?: WidgetLayoutLiteral[];
  lt?: number;
  lte?: number;
  ne?: WidgetLayoutLiteral;
}

/** Palette colors, plus semantic ones that follow the theme. */
export const WIDGET_LAYOUT_COLORS = [
  'primary',
  'success',
  'warning',
  'error',
  'text',
  'red',
  'volcano',
  'orange',
  'gold',
  'yellow',
  'lime',
  'green',
  'cyan',
  'blue',
  'geekblue',
  'purple',
  'magenta',
] as const;
export type WidgetLayoutColor = (typeof WIDGET_LAYOUT_COLORS)[number];

/**
 * Card backgrounds. `default` is the theme's card; the rest are fixed
 * gradients with light text, picked to read in both light and dark mode.
 */
export const WIDGET_LAYOUT_SURFACES = [
  'default',
  'sky',
  'cloudy',
  'rain',
  'storm',
  'snow',
  'night',
  'sunset',
  'forest',
  'ocean',
  'sand',
  'rose',
  'slate',
] as const;
export type WidgetLayoutSurface = (typeof WIDGET_LAYOUT_SURFACES)[number];

/** Icons a layout may name; kept to a fixed set so the bundle stays bounded. */
export const WIDGET_LAYOUT_ICONS = [
  // weather
  'sun',
  'moon',
  'cloud',
  'cloud-sun',
  'cloud-moon',
  'cloud-rain',
  'cloud-drizzle',
  'cloud-snow',
  'cloud-lightning',
  'cloud-fog',
  'cloud-hail',
  'snowflake',
  'wind',
  'droplet',
  'droplets',
  'thermometer',
  'umbrella',
  'sunrise',
  'sunset',
  'gauge',
  'eye',
  'navigation',
  // general
  'arrow-up',
  'arrow-down',
  'trending-up',
  'trending-down',
  'check',
  'x',
  'alert-triangle',
  'info',
  'clock',
  'calendar',
  'map-pin',
  'star',
  'heart',
  'flame',
  'zap',
  'activity',
  'target',
  'trophy',
  'users',
  'git-pull-request',
  'git-commit',
  'dollar-sign',
  'server',
  'database',
  'globe',
  'mail',
  'message-circle',
  'bell',
  'timer',
] as const;
export type WidgetLayoutIconName = (typeof WIDGET_LAYOUT_ICONS)[number];

export type WidgetLayoutTone =
  'default' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error';

interface WidgetLayoutNodeBase {
  /** Grow factor inside a stack, like CSS flex-grow. */
  flex?: number;
  /** Drop the node when the card is narrow (< 280px) or short (< 180px). */
  hideWhen?: 'narrow' | 'short';
  visible?: WidgetLayoutCondition;
}

export interface WidgetLayoutStackNode extends WidgetLayoutNodeBase {
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  children: WidgetLayoutNode[];
  direction?: 'row' | 'column';
  gap?: number;
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  padding?: number;
  type: 'stack';
  wrap?: boolean;
}

export interface WidgetLayoutGridNode extends WidgetLayoutNodeBase {
  children: WidgetLayoutNode[];
  columns: number;
  gap?: number;
  type: 'grid';
}

export interface WidgetLayoutTextNode extends WidgetLayoutNodeBase {
  align?: 'start' | 'center' | 'end';
  /** Clamp to this many lines. */
  lines?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'display';
  tone?: WidgetLayoutTone;
  type: 'text';
  value: WidgetLayoutValue;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

export interface WidgetLayoutIconNode extends WidgetLayoutNodeBase {
  color?: WidgetLayoutValue;
  /** One of `WIDGET_LAYOUT_ICONS`, usually mapped from data. */
  name: WidgetLayoutValue;
  size?: number;
  type: 'icon';
}

export interface WidgetLayoutImageNode extends WidgetLayoutNodeBase {
  fit?: 'cover' | 'contain';
  height?: number;
  radius?: number;
  /** https URL only. */
  src: WidgetLayoutValue;
  type: 'image';
  width?: number;
}

export interface WidgetLayoutProgressNode extends WidgetLayoutNodeBase {
  color?: WidgetLayoutValue;
  max?: WidgetLayoutValue;
  min?: WidgetLayoutValue;
  type: 'progress';
  value: WidgetLayoutValue;
}

export interface WidgetLayoutRingNode extends WidgetLayoutNodeBase {
  /** Content in the middle of the ring. */
  children?: WidgetLayoutNode[];
  color?: WidgetLayoutValue;
  max?: WidgetLayoutValue;
  size?: number;
  type: 'ring';
  value: WidgetLayoutValue;
}

export interface WidgetLayoutDotsNode extends WidgetLayoutNodeBase {
  color?: WidgetLayoutValue;
  columns?: number;
  total: WidgetLayoutValue;
  type: 'dots';
  /** How many dots are filled. */
  value: WidgetLayoutValue;
}

export interface WidgetLayoutSparklineNode extends WidgetLayoutNodeBase {
  color?: WidgetLayoutValue;
  height?: number;
  /** Property to read from each item when `values` points at objects. */
  key?: string;
  kind?: 'line' | 'area' | 'bar';
  type: 'sparkline';
  /** Path to an array of numbers (or of objects, with `key`). */
  values: string;
}

export interface WidgetLayoutBadgeNode extends WidgetLayoutNodeBase {
  color?: WidgetLayoutValue;
  type: 'badge';
  value: WidgetLayoutValue;
}

export interface WidgetLayoutDividerNode extends WidgetLayoutNodeBase {
  type: 'divider';
}

export interface WidgetLayoutSpacerNode extends WidgetLayoutNodeBase {
  type: 'spacer';
}

/** Render `template` once per array item; inside it `item` and `index` are in scope. */
export interface WidgetLayoutRepeatNode extends WidgetLayoutNodeBase {
  direction?: 'row' | 'column';
  gap?: number;
  items: string;
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  limit?: number;
  template: WidgetLayoutNode;
  type: 'repeat';
}

export type WidgetLayoutNode =
  | WidgetLayoutStackNode
  | WidgetLayoutGridNode
  | WidgetLayoutTextNode
  | WidgetLayoutIconNode
  | WidgetLayoutImageNode
  | WidgetLayoutProgressNode
  | WidgetLayoutRingNode
  | WidgetLayoutDotsNode
  | WidgetLayoutSparklineNode
  | WidgetLayoutBadgeNode
  | WidgetLayoutDividerNode
  | WidgetLayoutSpacerNode
  | WidgetLayoutRepeatNode;

export type WidgetLayoutNodeType = WidgetLayoutNode['type'];

/** Bounds every stored layout stays within. */
export const WIDGET_LAYOUT_LIMITS = {
  depth: 12,
  /** Most dots one `dots` node draws. */
  dots: 400,
  /**
   * Elements one card may draw: every node once, a `dots` node per dot, a bar
   * sparkline per bar, all multiplied by the enclosing repeat's limit.
   */
  elements: 2000,
  nodes: 200,
  repeat: 48,
  /** Most points a sparkline draws; longer arrays are sampled down. */
  seriesPoints: 240,
} as const;
