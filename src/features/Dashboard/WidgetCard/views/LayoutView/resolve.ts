import type {
  WidgetLayoutColor,
  WidgetLayoutCondition,
  WidgetLayoutFormat,
  WidgetLayoutLiteral,
  WidgetLayoutSurface,
  WidgetLayoutValue,
  WidgetOutput,
} from '@lobechat/types';
import { WIDGET_LAYOUT_COLORS, WIDGET_LAYOUT_SURFACES } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import dayjs from 'dayjs';

/** What layout paths read from: `data.*`, `output.*`, and `item` / `index` inside a repeat. */
export type LayoutScope = Record<string, unknown>;

/**
 * A `data` output exposes its payload as `data`; the built-in types expose the
 * whole output there too, so `data.value` reads a stat the same way.
 */
export const createLayoutScope = (output: WidgetOutput): LayoutScope => ({
  data: output.type === 'data' ? output.data : output,
  output,
});

export const getPath = (scope: unknown, path: string): unknown => {
  let current: unknown = scope;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const isBinding = (
  value: WidgetLayoutValue,
): value is Extract<WidgetLayoutValue, { bind: string }> =>
  typeof value === 'object' && value !== null && 'bind' in value;

const isTemplate = (value: WidgetLayoutValue): value is { template: string } =>
  typeof value === 'object' && value !== null && 'template' in value;

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const DATE_PATTERNS: Partial<Record<WidgetLayoutFormat, string>> = {
  date: 'MMM D',
  datetime: 'MMM D HH:mm',
  time: 'HH:mm',
  weekday: 'ddd',
};

/** Print one value the way `format` asks; unknown shapes fall back to plain text. */
export const formatLayoutValue = (
  raw: unknown,
  format?: WidgetLayoutFormat,
  options: { digits?: number; pattern?: string } = {},
): string => {
  if (raw === null || raw === undefined) return '';
  const { digits, pattern } = options;

  if (format && format in DATE_PATTERNS) {
    const date = dayjs(raw as string | number);
    return date.isValid() ? date.format(pattern ?? DATE_PATTERNS[format]) : String(raw);
  }
  if (format === 'relative') {
    const date = dayjs(raw as string | number);
    return date.isValid() ? date.fromNow() : String(raw);
  }

  const number = toNumber(raw);
  if (number !== undefined && (format || typeof raw === 'number')) {
    if (format === 'percent') {
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: digits ?? 0,
        style: 'percent',
      }).format(number);
    }
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: digits ?? (format === 'compact' ? 1 : 2),
      minimumFractionDigits: digits,
      notation: format === 'compact' ? 'compact' : 'standard',
    }).format(number);
  }

  if (typeof raw === 'object') return '';
  return String(raw);
};

/** `{path}`, `{path|format}` or `{path|format:digits}`, e.g. `{data.temp|number:0}`. */
const TEMPLATE_SLOT = /\{([\w$.-]+)(?:\|(\w+)(?::(\d))?)?\}/g;

/**
 * Resolve a layout value to what it stands for in this scope. Bindings keep
 * the raw value (a number stays a number for progress / dots); use
 * `resolveText` for anything printed.
 */
export const resolveRaw = (value: WidgetLayoutValue | undefined, scope: LayoutScope): unknown => {
  if (value === undefined) return undefined;
  if (isTemplate(value)) return resolveText(value, scope);
  if (!isBinding(value)) return value;

  const raw = getPath(scope, value.bind);
  if (value.map && raw !== null && raw !== undefined) {
    const mapped = value.map[String(raw)];
    if (mapped !== undefined) return mapped;
    if ('*' in value.map) return value.map['*'];
  }
  return raw ?? value.fallback;
};

export const resolveText = (value: WidgetLayoutValue | undefined, scope: LayoutScope): string => {
  if (value === undefined) return '';
  if (isTemplate(value)) {
    return value.template.replaceAll(
      TEMPLATE_SLOT,
      (_, path: string, format?: string, digits?: string) =>
        formatLayoutValue(getPath(scope, path), format as WidgetLayoutFormat | undefined, {
          digits: digits === undefined ? undefined : Number(digits),
        }),
    );
  }
  if (isBinding(value)) {
    // A mapped value is the layout's own word ("Rain"), not a number to format.
    const raw = resolveRaw(value, scope);
    const mapped = value.map && raw !== getPath(scope, value.bind);
    return formatLayoutValue(raw, mapped ? undefined : value.format, value);
  }
  return formatLayoutValue(value);
};

export const resolveNumber = (
  value: WidgetLayoutValue | undefined,
  scope: LayoutScope,
): number | undefined => toNumber(resolveRaw(value, scope));

const compare = (raw: unknown, expected: WidgetLayoutLiteral) =>
  raw === expected || (raw !== null && raw !== undefined && String(raw) === String(expected));

export const checkCondition = (
  condition: WidgetLayoutCondition | undefined,
  scope: LayoutScope,
): boolean => {
  if (!condition) return true;
  const raw = getPath(scope, condition.bind);
  const exists = raw !== null && raw !== undefined && raw !== '';
  if (condition.exists !== undefined && condition.exists !== exists) return false;
  if (condition.eq !== undefined && !compare(raw, condition.eq)) return false;
  if (condition.ne !== undefined && compare(raw, condition.ne)) return false;
  if (condition.in && !condition.in.some((entry) => compare(raw, entry))) return false;

  const number = toNumber(raw);
  const bounds = [
    [condition.gt, (n: number, b: number) => n > b],
    [condition.gte, (n: number, b: number) => n >= b],
    [condition.lt, (n: number, b: number) => n < b],
    [condition.lte, (n: number, b: number) => n <= b],
  ] as const;
  for (const [bound, test] of bounds) {
    if (bound === undefined) continue;
    if (number === undefined || !test(number, bound)) return false;
  }
  return true;
};

const SEMANTIC_COLORS: Record<string, string> = {
  error: cssVar.colorError,
  primary: cssVar.colorPrimary,
  success: cssVar.colorSuccess,
  text: 'currentColor',
  warning: cssVar.colorWarning,
};

/** A layout color as CSS; unknown or missing colors follow the text color. */
export const resolveColor = (value: WidgetLayoutValue | undefined, scope: LayoutScope): string => {
  const name = resolveRaw(value, scope);
  if (typeof name !== 'string' || !(WIDGET_LAYOUT_COLORS as readonly string[]).includes(name)) {
    return 'currentColor';
  }
  return (
    SEMANTIC_COLORS[name] ??
    (cssVar as unknown as Record<string, string>)[name as WidgetLayoutColor] ??
    'currentColor'
  );
};

export const resolveSurface = (
  value: WidgetLayoutValue | undefined,
  scope: LayoutScope,
): WidgetLayoutSurface => {
  const name = resolveRaw(value, scope);
  return typeof name === 'string' && (WIDGET_LAYOUT_SURFACES as readonly string[]).includes(name)
    ? (name as WidgetLayoutSurface)
    : 'default';
};

/** The array at `path`, as numbers — read from `key` when the items are objects. */
export const resolveNumbers = (path: string, scope: LayoutScope, key?: string): number[] => {
  const list = getPath(scope, path);
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => toNumber(key ? getPath(entry, key) : entry))
    .filter((entry): entry is number => entry !== undefined);
};
