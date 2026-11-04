const MIN_DIGITS = 2;
const MAX_DIGITS = 4;

/** Decimals one amount needs, from `MIN_DIGITS` up to `MAX_DIGITS`. */
const getAmountDigits = (amount: number) => {
  const magnitude = Math.abs(amount);

  // An amount below the finest step still needs the finest step, or it reads as free
  if (magnitude > 0 && magnitude < 10 ** -MAX_DIGITS / 2) return MAX_DIGITS;

  const fraction = (magnitude.toFixed(MAX_DIGITS).split('.')[1] ?? '').replace(/0+$/, '');

  return Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, fraction.length));
};

/**
 * Decimals to show every amount of one panel with: the most any of them needs, between 2 and 4.
 * `$0.0012`, `$0.0100` and `$0.0113` line up in a column; `$0.0012`, `$0.01` and `$0.0113` do not.
 * Values that are not finite (a model with no rate) are ignored.
 */
export const getUsdDigits = (amounts: number[]) =>
  amounts
    .filter((amount) => Number.isFinite(amount))
    .reduce((digits, amount) => Math.max(digits, getAmountDigits(amount)), MIN_DIGITS);

interface FormatUsdDigitsOptions {
  /** Set to `false` when the surrounding copy already carries the `$`. Defaults to `true`. */
  withSymbol?: boolean;
}

/**
 * Format a dollar amount with a fixed number of decimals. A positive amount below the step
 * reads `<$0.0001` rather than `$0.0000`; a value that is not finite reads `--`.
 */
export const formatUsdDigits = (
  usd: number,
  digits: number,
  { withSymbol = true }: FormatUsdDigitsOptions = {},
): string => {
  if (!Number.isFinite(usd)) return '--';

  const symbol = withSymbol ? '$' : '';
  const sign = usd < 0 ? '-' : '';
  const magnitude = Math.abs(usd);
  const step = 10 ** -digits;

  if (magnitude > 0 && magnitude < step / 2) return `${sign}<${symbol}${step.toFixed(digits)}`;

  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(magnitude);

  return `${sign}${symbol}${formatted}`;
};

/** Build a formatter that shows every amount in `amounts` (and any other) with the same decimals. */
export const createUsdFormatter = (amounts: number[]) => {
  const digits = getUsdDigits(amounts);

  return (usd: number) => formatUsdDigits(usd, digits);
};
