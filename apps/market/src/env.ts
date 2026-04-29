import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MARKET_BASE_URL: z.string().url().optional(),
  MARKET_PORT: z.coerce.number().int().positive().default(3211),
  MARKET_PUBLIC_BASE_URL: z.string().url().optional(),
  MARKET_TRUSTED_CLIENT_ID: z.string().min(1),
  MARKET_TRUSTED_CLIENT_SECRET: z.string().min(1),
  MARKET_UPSTREAM_BASE_URL: z.string().url().optional(),
});

export type MarketEnv = z.infer<typeof EnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): MarketEnv => {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Market environment: ${message}`);
  }

  return result.data;
};
