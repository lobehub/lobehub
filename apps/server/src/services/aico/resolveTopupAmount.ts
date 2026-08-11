import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  microUsdToToman,
  tomanToMicroUsd,
  usdDecimalStringToMicro,
} from '@/database/utils/aicoMoney';

import { getTomanPerUsd } from './fxService';

export const topupAmountInputSchema = z
  .object({
    amountToman: z.number().int().positive().max(100_000_000).optional(),
    amountUsd: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.amountToman) !== Boolean(value.amountUsd), {
    message: 'EXACTLY_ONE_AMOUNT_REQUIRED',
  });

export type TopupAmountInput = z.infer<typeof topupAmountInputSchema>;

const toIntegerFxRate = (rate: number): number => {
  const rounded = Math.round(rate);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'INVALID_FX_RATE' });
  }
  return rounded;
};

const microToSafeInteger = (micro: bigint, label: string): number => {
  if (micro <= 0n) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `AMOUNT_MUST_BE_POSITIVE:${label}` });
  }
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `AMOUNT_TOO_LARGE:${label}` });
  }
  return Number(micro);
};

export const resolveTopupAmount = async (
  input: TopupAmountInput,
  options?: { adminRate?: number | null },
) => {
  const { rate, source } = await getTomanPerUsd(options?.adminRate);
  const fxRateTomanPerUsd = toIntegerFxRate(rate);

  if (input.amountToman != null) {
    const amountMicroUsd = microToSafeInteger(
      tomanToMicroUsd(input.amountToman, fxRateTomanPerUsd),
      'micro_usd',
    );
    return {
      amountMicroUsd,
      amountToman: input.amountToman,
      fxRateTomanPerUsd,
      fxSource: source,
    };
  }

  const micro = usdDecimalStringToMicro(input.amountUsd!);
  const amountMicroUsd = microToSafeInteger(micro, 'micro_usd');
  const amountToman = Number(microUsdToToman(micro, BigInt(fxRateTomanPerUsd)));

  return {
    amountMicroUsd,
    amountToman,
    fxRateTomanPerUsd,
    fxSource: source,
  };
};
