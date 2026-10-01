# Cost

alint spends model tokens per file per rule. Its cost is therefore **rules × files that
changed**, minus cache hits. Two things dominate a bill: a rule edit that invalidates the
cache, and a local whole-repo calibration scan.

## What a run reports

`alint --format json` returns, besides `diagnostics`:

```jsonc
"execution": { "cached": 0, "completed": 2, "failed": 0, "planned": 2, … },
"usage": {
  "inputTokens": 2626,
  "outputTokens": 223,
  "totalTokens": 2849,
  "records": [
    { "ruleId": "lobehub/ui-content-width", "modelId": "deepseek-flash",
      "providerId": "api.deepseek.com", "inputTokens": 1347, "outputTokens": 189,
      "totalTokens": 1536 }
  ]
}
```

`usage.records` is per rule, so it answers "which rule costs the most" directly. Summarise a
saved run (or several) with [`scripts/cost-report.ts`](../scripts/cost-report.ts):

```bash
bun .agents/skills/alint-ruleset/scripts/cost-report.ts /tmp/alint-scan/raw.json --price-in 1 --price-in-hit 0.1 --price-out 2
```

CI reports the same numbers on every run: `packages/alint/report.ts` appends a usage line to
the ALint check run summary and the PR comment, in the form

```
42 model calls, 12 cached · 12,345 input / 678 output tokens
```

`cost-report.ts` also reads that line out of a `runs.json` produced by
`pull-alint-runs.ts`, so the weekly cost is read from CI rather than estimated.

## Two keys, never one number

- **CI key** — the `DEEPSEEK_API_KEY` repository secret, spent by the `ALint & Test Desktop
  App` job on every push. This is the recurring cost.
- **Local / calibration key** — whatever the operator uses for scans. A whole-repo cold
  calibration pass is a one-off cost that dwarfs a normal CI day; never fold it into the CI
  figure, and never quote a total without naming which key it came from.

## Cache semantics — the cost driver

alint caches by **file content**; unchanged files cost nothing on a repeat run.

- Current `@alint-js/cli` (0.7.2+) keys a declarative rule's cache on its own instruction
  (`cacheKey`), so editing one rule re-runs **only that rule**.
- Earlier versions had no per-rule key: CI keyed the whole cache on the hash of **all** rule
  files, so editing any one rule invalidated every rule for every file. That is why the bill
  peaked on the days a rule changed, and why a release PR that day did a full cold run. Keep
  the dependency current so this does not come back.
- Locally, the cache is keyed by file content only: an edited rule replays the previous rule's
  findings unless `.alintcache` is deleted. Clear it after every rule edit.

## Reduce cost, in order of payoff

1. **Stay on a current `@alint-js/cli`** so per-rule cache keys apply. Cheapest, largest win.
2. **Calibrate on samples, not whole-repo cold scans.** A full scan is the single biggest
   one-off cost (tens of millions of tokens). Calibrate the rule's scope, sample ~20 findings.
3. **Prefer file-before-instruction in the prompt** so DeepSeek's context cache is reused
   across the rules that read the same file (hit tokens are ~1/10 the price). As of 0.7.3 this
   is upstream work, not yet in alint — verify before relying on it, and re-calibrate fixtures
   after any prompt-order change.
4. **Narrow a rule's scope, or move it to `alint.audit.toml`**, when its cost is dominated by a
   wide scope with weak precision. A rule that reports on every backend file multiplies the
   per-file calls; the `ui-*` audit rules are deliberately out of the PR check for this reason.

## Unit prices

Observed for DeepSeek flash, reverse-engineered from the bill: input miss ≈ ¥1 / M tokens,
cache hit ≈ ¥0.1 / M, output ≈ ¥2 / M. Treat these as estimates — re-derive them from the
actual bill each window, and always record the window and the key alongside any number.

## A note on estimates

Estimating cost by "every file each commit touched" over-counts several-fold: only the pushed
head commit runs, file contents are cached, and files in a release PR were usually already run
in their feature PR. Prefer the reported usage over any reconstruction; when reconstructing,
say it is a reconstruction. Reverse-engineering the CI bill is what exposed the original
4–5× over-estimate.
