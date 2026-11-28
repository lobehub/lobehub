import type { ScenarioBudget, ScenarioName } from './metrics';

/**
 * Latency budgets for gateway-mode Claude Code, checked by
 * `bun run bench:cc-gateway --agent <agentId>` against a real connected device.
 * Metric definitions live on `TurnMetrics` in `./metrics.ts`; each ceiling
 * applies to the p50 of a run.
 *
 * Scenarios: `hello` (a cold topic answering one word), `followUp` (a second
 * turn in the same topic), `image` (an uploaded PNG described in one word),
 * `approve` / `reject` (a Write outside the working directory, which Claude
 * Code always asks about, answered right after the card shows).
 *
 * Baseline on app.lobehub.com, 2026-11-29, 3 runs, CLI from this bench's PR
 * with the server still on the previous deploy (p50 / p90, seconds):
 *
 * | scenario | ack       | firstOutput | approvalEvent | nextOutputAfterResolve |
 * | -------- | --------- | ----------- | ------------- | ---------------------- |
 * | hello    | 1.62/1.68 | 8.18/8.21   |               |                        |
 * | followUp | 1.60/1.63 | 6.90/7.05   |               |                        |
 * | image    | 1.47/1.60 | 7.58/7.98   |               |                        |
 * | approve  | 1.49/1.62 | 10.13/10.38 | 10.16/10.42   | 2.71/3.22              |
 * | reject   | 1.40/1.86 | 8.96/9.78   | 9.86/10.31    | 1.34/10.65             |
 *
 * Before that PR, single runs measured firstOutput 9.3-10.4 s for `hello` and
 * 11.9-12.5 s for `image`, and nextOutputAfterResolve 2.5-3.9 s for `approve`
 * and 1.7-3.2 s for `reject`.
 *
 * A `hello` turn splits into ~1.9 s of server dispatch (`init`), ~2.7 s more
 * until Claude Code's first frame reaches the server (`deviceFirstEvent`),
 * and 2-3.5 s more for the model's first output. Timings swing a few hundred
 * ms between runs, and a resolve that lands on a cold Vercel instance adds
 * ~8 s (the 10.65 s reject p90 above), so the ceilings only catch a path that
 * got far slower than any baseline run. `end` and `visibleEnd` follow the
 * model's answer length and are reported, not gated.
 */
export const CC_GATEWAY_BUDGETS: Partial<Record<ScenarioName, ScenarioBudget>> = {
  approve: { ack: 3000, approvalEvent: 13_000, nextOutputAfterResolve: 5000 },
  followUp: { ack: 3000, firstOutput: 10_000 },
  hello: { ack: 3000, firstOutput: 11_000 },
  image: { ack: 3000, firstOutput: 11_000 },
  reject: { ack: 3000, approvalEvent: 13_000, nextOutputAfterResolve: 4000 },
};
