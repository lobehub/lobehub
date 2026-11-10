import { TRPCError } from '@trpc/server';
import { z } from 'zod';

/** `metadata.kind` of a Lobe Bench benchmark (the Evaluation Lab's have none). */
const LOBE_BENCH_KIND = 'lobe-bench';

export const benchmarkJudgeSchema = z
  .object({ model: z.string().trim().min(1), provider: z.string().trim().min(1) })
  .strict();

/** How every case of the benchmark is run: attempts per case, step limit, per-case timeout. */
export const benchmarkProtocolSchema = z
  .object({
    k: z.number().int().min(1).max(5),
    maxSteps: z.number().int().min(1).max(500),
    timeoutMinutes: z.number().int().min(1).max(240),
  })
  .strict();

export type BenchmarkProtocol = z.infer<typeof benchmarkProtocolSchema>;

type Metadata = Record<string, unknown> | null | undefined;

const isLobeBench = (metadata: Metadata) => metadata?.kind === LOBE_BENCH_KIND;

const missing = () =>
  new TRPCError({
    code: 'BAD_REQUEST',
    message:
      "Choose the judge model and the run rules (attempts per case, max steps, timeout) this benchmark's runs follow.",
  });

/**
 * The run rules a benchmark fixes: `metadata.protocol`, or for one made before
 * they were fixed, its complete `defaults`.
 */
export const benchmarkProtocolOf = (metadata: Metadata): BenchmarkProtocol | undefined => {
  const parsed = benchmarkProtocolSchema.safeParse(metadata?.protocol ?? metadata?.defaults);
  return parsed.success ? parsed.data : undefined;
};

/**
 * Every run on a Lobe Bench benchmark is graded by one judge and run under one
 * set of rules, both chosen when the benchmark is made, so its scores stay
 * comparable.
 */
export const assertNewBenchmarkStandard = (metadata: Metadata) => {
  if (!isLobeBench(metadata)) return;
  if (
    !benchmarkJudgeSchema.safeParse(metadata?.judge).success ||
    !benchmarkProtocolSchema.safeParse(metadata?.protocol).success
  )
    throw missing();
};

/**
 * An update never changes a Lobe Bench benchmark's judge or run rules. One
 * made before they were required may get them once; after that they are fixed.
 */
export const keepBenchmarkStandard = (next: Metadata, current: Metadata): Metadata => {
  if (!next || !isLobeBench(current)) return next;
  const kept = { ...next };
  for (const [field, schema] of [
    ['judge', benchmarkJudgeSchema],
    ['protocol', benchmarkProtocolSchema],
  ] as const) {
    if (current?.[field]) kept[field] = current[field];
    else if (kept[field] !== undefined && !schema.safeParse(kept[field]).success) throw missing();
  }
  return kept;
};

/**
 * A run on a Lobe Bench benchmark follows the benchmark's judge and rules: a
 * run configured otherwise is refused, so no client can rank a different setup
 * next to it.
 */
export const assertRunFollowsBenchmark = (
  config:
    | {
        judgeModel?: string;
        judgeProvider?: string;
        k?: number;
        maxSteps?: number;
        timeout?: number;
      }
    | undefined,
  metadata: Metadata,
) => {
  if (!isLobeBench(metadata)) return;
  const judge = benchmarkJudgeSchema.safeParse(metadata?.judge);
  const protocol = benchmarkProtocolOf(metadata);
  const differs =
    (judge.success &&
      (config?.judgeModel !== judge.data.model || config?.judgeProvider !== judge.data.provider)) ||
    (protocol &&
      ((config?.k ?? 1) !== protocol.k ||
        config?.maxSteps !== protocol.maxSteps ||
        config?.timeout !== protocol.timeoutMinutes * 60_000));
  if (differs)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        "A run on this benchmark must use the benchmark's judge, attempts per case, max steps and timeout.",
    });
};
