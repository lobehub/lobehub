/**
 * Thousand-grouped display helpers for Ant Design `InputNumber`.
 * Keeps Latin digits + comma grouping so paste/parse stays predictable across locales.
 */

const GROUP_SEP = /[,\u066C\s]/g;
const ARABIC_DECIMAL = /\u066B/g;

/** Format a numeric InputNumber value as `1,234,567.89`. */
export const formatGroupedNumberInput = (value: string | number | undefined): string => {
  if (value === undefined || value === null || value === '') return '';

  const raw = String(value);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart, ...fracParts] = unsigned.split('.');
  const grouped = intPart.replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fracParts.length > 0 ? `${grouped}.${fracParts.join('.')}` : grouped;

  return negative ? `-${body}` : body;
};

/** Strip grouping separators (and normalize Persian decimal) for InputNumber parsing. */
export const parseGroupedNumberInput = (value: string | undefined): string => {
  if (!value) return '';
  return value.replaceAll(ARABIC_DECIMAL, '.').replaceAll(GROUP_SEP, '');
};

/** Spread onto Ant Design `InputNumber` for thousand-separated display. */
export const groupedNumberInputProps = {
  formatter: formatGroupedNumberInput,
  parser: parseGroupedNumberInput,
} as const;
