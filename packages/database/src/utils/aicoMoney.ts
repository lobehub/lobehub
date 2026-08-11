/**
 * Aico money helpers — integer minor units only.
 * USD is stored as micro-USD (1 USD = 1_000_000 µUSD).
 * Toman is stored as integer Toman.
 * Never use IEEE-754 float arithmetic for balances, reservations, refunds, or FX.
 */

export const MICRO_USD_PER_USD = 1_000_000n;

export type BudgetPeriod = 'total' | 'daily' | 'weekly' | 'monthly';

/** Product-facing org member periods (AICO-140). Legacy `total` is grandfathered only. */
export type ProductBudgetPeriod = 'daily' | 'weekly' | 'monthly';

export const BUDGET_PERIODS: readonly BudgetPeriod[] = [
  'total',
  'daily',
  'weekly',
  'monthly',
] as const;

export const PRODUCT_BUDGET_PERIODS: readonly ProductBudgetPeriod[] = [
  'daily',
  'weekly',
  'monthly',
] as const;

export const isBudgetPeriod = (value: string): value is BudgetPeriod =>
  (BUDGET_PERIODS as readonly string[]).includes(value);

export const isProductBudgetPeriod = (value: string): value is ProductBudgetPeriod =>
  (PRODUCT_BUDGET_PERIODS as readonly string[]).includes(value);

/** OpenRouter Management API `limit_reset` mapping (midnight UTC; weeks Mon–Sun). */
export const periodToOpenRouterLimitReset = (
  period: BudgetPeriod,
): 'daily' | 'weekly' | 'monthly' | null => {
  switch (period) {
    case 'daily': {
      return 'daily';
    }
    case 'weekly': {
      return 'weekly';
    }
    case 'monthly': {
      return 'monthly';
    }
    default: {
      return null;
    }
  }
};

const assertFiniteIntegerString = (raw: string, label: string): bigint => {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`INVALID_MONEY:${label}`);
  }
  return BigInt(trimmed);
};

/** Parse a decimal USD string (e.g. "12.345678") into micro-USD, truncating toward zero. */
export const usdDecimalStringToMicro = (value: string): bigint => {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error('INVALID_USD_DECIMAL');

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fracPart = ''] = unsigned.split('.');
  const frac = (fracPart + '000000').slice(0, 6);
  const micro = BigInt(wholePart || '0') * MICRO_USD_PER_USD + BigInt(frac || '0');
  return negative ? -micro : micro;
};

/** Format micro-USD as a fixed 6-decimal string for API/tRPC. */
export const microUsdToDecimalString = (micro: bigint | number | string): string => {
  const value =
    typeof micro === 'bigint' ? micro : assertFiniteIntegerString(String(micro), 'micro');
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICRO_USD_PER_USD;
  const frac = abs % MICRO_USD_PER_USD;
  const fracStr = frac.toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`;
};

/** Convert OpenRouter USD number/limit into micro-USD (floor toward zero — never over-credit). */
export const openRouterUsdToMicroFloor = (usd: number): bigint => {
  if (!Number.isFinite(usd)) throw new Error('INVALID_OR_USD');
  // Capture extra fractional digits then truncate to micro (do not use toFixed(6), which rounds).
  const negative = usd < 0;
  const [wholePart, fracPart = ''] = Math.abs(usd).toFixed(8).split('.');
  const frac = fracPart.slice(0, 6).padEnd(6, '0');
  const micro = BigInt(wholePart || '0') * MICRO_USD_PER_USD + BigInt(frac || '0');
  return negative ? -micro : micro;
};

/**
 * FX: toman → micro-USD using integer math.
 * rate = toman per 1 USD (positive integer or integer string).
 * Floor toward zero so Aico never over-credits.
 */
export const tomanToMicroUsd = (
  amountToman: bigint | number | string,
  tomanPerUsd: bigint | number | string,
): bigint => {
  const toman = typeof amountToman === 'bigint' ? amountToman : BigInt(amountToman);
  const rate = typeof tomanPerUsd === 'bigint' ? tomanPerUsd : BigInt(tomanPerUsd);
  if (toman <= 0n) throw new Error('INVALID_TOMAN_AMOUNT');
  if (rate <= 0n) throw new Error('INVALID_FX_RATE');
  return (toman * MICRO_USD_PER_USD) / rate;
};

/** Inverse of tomanToMicroUsd — floor toward zero. */
export const microUsdToToman = (
  micro: bigint | number | string,
  tomanPerUsd: bigint | number | string,
): bigint => {
  const microValue =
    typeof micro === 'bigint' ? micro : assertFiniteIntegerString(String(micro), 'micro');
  const rate = typeof tomanPerUsd === 'bigint' ? tomanPerUsd : BigInt(tomanPerUsd);
  if (microValue <= 0n) throw new Error('INVALID_MICRO_USD_AMOUNT');
  if (rate <= 0n) throw new Error('INVALID_FX_RATE');
  return (microValue * rate) / MICRO_USD_PER_USD;
};

/** Confirmed unused reservation: never negative; floor already implied by integer subtraction. */
export const confirmedUnusedMicro = (reserved: bigint, authoritativeUsage: bigint): bigint => {
  const unused = reserved - authoritativeUsage;
  return unused > 0n ? unused : 0n;
};

export const assertPositiveMicro = (value: bigint, label = 'amount'): void => {
  if (value <= 0n) throw new Error(`AMOUNT_MUST_BE_POSITIVE:${label}`);
};

export const assertNonNegativeMicro = (value: bigint, label = 'amount'): void => {
  if (value < 0n) throw new Error(`AMOUNT_MUST_BE_NON_NEGATIVE:${label}`);
};

/** JSON-safe money field (decimal string). */
export const moneyString = (micro: bigint | number | string): string =>
  microUsdToDecimalString(micro);

export const tomanString = (toman: bigint | number | string): string => {
  const value = typeof toman === 'bigint' ? toman : BigInt(toman);
  return value.toString();
};

/** Member budget fields needed for current-cycle spend math (FIN-001). */
export type MemberBudgetCycleFields = {
  periodAmountMicroUsd?: number | null;
  reservedMicroUsd?: number | null;
  settledUsageMicroUsd?: number | null;
};

/**
 * Current-cycle spendable cap for a member budget.
 * Pending next-period holds inflate `reservedMicroUsd` but must not raise the
 * live OpenRouter limit until renewal applies them.
 */
export const currentCycleLimitMicroUsd = (budget: MemberBudgetCycleFields): number => {
  const periodAmount = Number(budget.periodAmountMicroUsd ?? 0);
  if (periodAmount > 0) return periodAmount;
  return Number(budget.reservedMicroUsd ?? 0);
};

/** Spendable remaining in the active billing cycle (excludes pending next-period hold). */
export const cycleRemainingMicroUsd = (budget: MemberBudgetCycleFields): number => {
  const limit = currentCycleLimitMicroUsd(budget);
  const settled = Math.max(0, Number(budget.settledUsageMicroUsd ?? 0));
  return Math.max(0, limit - settled);
};

export const isStaleManagedKeyId = (keyId: string | null | undefined): boolean =>
  !keyId || keyId.startsWith('mock_');

export const hasValidManagedKeyId = (keyId: string | null | undefined): boolean =>
  Boolean(keyId) && !isStaleManagedKeyId(keyId);
