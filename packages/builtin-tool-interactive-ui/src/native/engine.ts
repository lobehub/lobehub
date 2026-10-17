import { isPlainRecord } from '@lobechat/utils/object';

import { NATIVE_UI_LIMITS } from './schema';
import type {
  NativeUIChartData,
  NativeUIChartNode,
  NativeUIDocument,
  NativeUIExpression,
  NativeUIState,
  NativeUIStateDefinition,
  NativeUIValue,
} from './types';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= NATIVE_UI_LIMITS.number;

const normalizeStateValue = (
  definition: NativeUIStateDefinition,
  value: unknown,
): NativeUIValue | undefined => {
  if (definition.type === 'number') {
    if (!finite(value)) return undefined;
    let next = Math.min(definition.max, Math.max(definition.min, value));
    if (definition.step !== undefined) {
      next =
        definition.min + Math.round((next - definition.min) / definition.step) * definition.step;
      next = Math.min(definition.max, Math.max(definition.min, Number(next.toFixed(12))));
    }
    return next;
  }
  if (definition.type === 'string') {
    return typeof value === 'string' &&
      value.length <= NATIVE_UI_LIMITS.text &&
      (!definition.options || definition.options.includes(value))
      ? value
      : undefined;
  }
  return typeof value === 'boolean' ? value : undefined;
};

/** Restore only declared scalar values. Corrupt values fall back to document defaults. */
export const createNativeUIState = (document: NativeUIDocument, saved?: unknown): NativeUIState => {
  const source = isPlainRecord(saved) ? saved : {};
  return Object.fromEntries(
    Object.entries(document.state).map(([key, definition]) => [
      key,
      (Object.hasOwn(source, key) ? normalizeStateValue(definition, source[key]) : undefined) ??
        normalizeStateValue(definition, definition.initial) ??
        definition.initial,
    ]),
  );
};

/** Each control writes the same validated state map; unknown/invalid updates are no-ops. */
export const updateNativeUIState = (
  document: NativeUIDocument,
  state: NativeUIState,
  key: string,
  value: unknown,
): NativeUIState => {
  if (!Object.hasOwn(document.state, key)) return state;
  const normalized = normalizeStateValue(document.state[key], value);
  if (normalized === undefined || normalized === state[key]) return state;
  return { ...state, [key]: normalized };
};

interface EvaluationContext {
  x?: number;
}

/** A fresh cache belongs to one state snapshot and one contextual x, never to the document. */
const createEvaluator = (
  document: NativeUIDocument,
  state: NativeUIState,
  context: EvaluationContext,
) => {
  const cache = new Map<string, NativeUIValue | null>();
  const visiting = new Set<string>();
  let remaining = NATIVE_UI_LIMITS.expressions * 2;
  const evaluate = (expression: NativeUIExpression, depth = 0): NativeUIValue | null => {
    if (--remaining < 0 || depth > 80) return null;
    if (typeof expression !== 'object') {
      return typeof expression === 'number' ? (finite(expression) ? expression : null) : expression;
    }
    if ('ref' in expression) {
      if (expression.ref === 'x') return finite(context.x) ? context.x : null;
      const ref = /^(state|derived)\.([A-Za-z][\w-]{0,63})$/.exec(expression.ref);
      if (!ref) return null;
      const key = ref[2];
      if (ref[1] === 'state') {
        if (!Object.hasOwn(document.state, key) || !Object.hasOwn(state, key)) return null;
        return normalizeStateValue(document.state[key], state[key]) ?? null;
      }
      if (!Object.hasOwn(document.derived, key) || visiting.has(key)) return null;
      if (cache.has(key)) return cache.get(key)!;
      visiting.add(key);
      const result = evaluate(document.derived[key], depth + 1);
      visiting.delete(key);
      cache.set(key, result);
      return result;
    }
    // Conditional branches are lazy, so an unused division by zero remains harmless.
    if (expression.op === 'if') {
      const condition = evaluate(expression.args[0], depth + 1);
      return typeof condition === 'boolean'
        ? evaluate(expression.args[condition ? 1 : 2], depth + 1)
        : null;
    }
    const values = expression.args.map((arg) => evaluate(arg, depth + 1));
    if (values.includes(null)) return null;
    if (expression.op === 'equal') return values[0] === values[1];
    if (expression.op === 'concat') {
      const result = values.join('');
      return result.length <= NATIVE_UI_LIMITS.text ? result : null;
    }
    if (!values.every(finite)) return null;
    const [first, second] = values;
    let result: number;
    switch (expression.op) {
      case 'add': {
        result = values.reduce((sum, value) => sum + value, 0);
        break;
      }
      case 'subtract': {
        result = first - second;
        break;
      }
      case 'multiply': {
        result = values.reduce((product, value) => product * value, 1);
        break;
      }
      case 'divide': {
        if (second === 0) return null;
        result = first / second;
        break;
      }
      case 'min': {
        result = Math.min(...values);
        break;
      }
      case 'max': {
        result = Math.max(...values);
        break;
      }
      case 'less': {
        return first < second;
      }
      case 'greater': {
        return first > second;
      }
      case 'round':
      case 'format': {
        const decimals = second ?? 0;
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return null;
        if (expression.op === 'format') return first.toFixed(decimals);
        result = Number(first.toFixed(decimals));
        break;
      }
      default: {
        return null;
      }
    }
    return finite(result) ? result : null;
  };
  return evaluate;
};

/** Closed, pure expression interpreter. Invalid math returns null rather than NaN/Infinity. */
export const evaluateNativeExpression = (
  expression: NativeUIExpression,
  document: NativeUIDocument,
  state: NativeUIState,
  context: EvaluationContext = {},
): NativeUIValue | null => createEvaluator(document, state, context)(expression);

/** Uniform bounded samples; cursor values are independently evaluated at the exact current x. */
export const sampleNativeChart = (
  chart: NativeUIChartNode,
  document: NativeUIDocument,
  state: NativeUIState,
): NativeUIChartData => {
  const samples = Math.min(NATIVE_UI_LIMITS.samples, Math.max(2, Math.floor(chart.x.samples)));
  const series = chart.series.slice(0, NATIVE_UI_LIMITS.series);
  const evaluateAt = (x: number) => {
    const evaluate = createEvaluator(document, state, { x });
    return Object.fromEntries(
      series.map((item) => {
        const value = evaluate(item.y);
        return [item.id, finite(value) ? value : null];
      }),
    );
  };
  const data = Array.from({ length: samples }, (_, index) => {
    const x = chart.x.min + ((chart.x.max - chart.x.min) * index) / (samples - 1);
    return { ...evaluateAt(x), x };
  });
  const value =
    chart.currentX === undefined ? null : evaluateNativeExpression(chart.currentX, document, state);
  const currentX = finite(value) && value >= chart.x.min && value <= chart.x.max ? value : null;
  return { currentValues: currentX === null ? {} : evaluateAt(currentX), currentX, data };
};
