import type { NativeUIValue } from '../types';
import { isFiniteNumber } from './chartGeometry';

export const displayValue = (value: NativeUIValue | null, locale?: string): string => {
  if (value === null || (typeof value === 'number' && !isFiniteNumber(value))) return '—';
  if (typeof value !== 'number') return String(value);
  if (value !== 0 && Math.abs(value) < 0.0001) {
    return new Intl.NumberFormat(locale, {
      maximumSignificantDigits: 4,
      notation: 'scientific',
    }).format(value);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
};

export const displayChartNumber = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, {
    ...(value !== 0 && Math.abs(value) < 0.01
      ? { maximumSignificantDigits: 3, notation: 'scientific' as const }
      : {
          maximumFractionDigits: 2,
          notation: Math.abs(value) >= 10_000 ? ('compact' as const) : ('standard' as const),
        }),
  }).format(value);

/** Select/Radio use opaque indices so string, numeric and boolean values stay distinct. */
export const selectedOptionKey = (
  options: ReadonlyArray<{ value: NativeUIValue }>,
  value: NativeUIValue | undefined,
): string | undefined => {
  const index = options.findIndex((option) => option.value === value);
  return index < 0 ? undefined : String(index);
};

export const selectedOptionValue = (
  options: ReadonlyArray<{ value: NativeUIValue }>,
  key: unknown,
): NativeUIValue | undefined => {
  if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
  return options[Number(key)]?.value;
};

export const canPropose = (
  value: NativeUIValue | null,
  { disabled, readOnly, trusted }: { disabled?: boolean; readOnly?: boolean; trusted: boolean },
): value is string =>
  trusted && !disabled && !readOnly && typeof value === 'string' && value.trim().length > 0;
