# Weekly review

The weekly run is the **incremental** half of the [loop](../SKILL.md#the-loop): it looks at what
changed since the last run and produces a short report plus the decisions that need the owner.
It does not re-do the initial calibration.

Cadence: once a week. It changes nothing on the product and promotes nothing on its own — it
recommends, and opens a PR only for a change that is already calibrated and unambiguously
zero-false-positive.

## Preflight

1. `.alint/config.toml` exists and the provider answers; `bun run alint plugin install` is current.
2. `lh` is authenticated (for acceptances) and `gh` is authenticated (for CI runs), or the
   equivalent credentials are injected.
3. Know the **window**: the 7 days since the last run, not "recently".

## Segment A — new standard

Pull the window's review feedback and classify it into rule candidates. Do **not** author rules
in the weekly run; produce the list.

```bash
bun .agents/skills/alint-ruleset/scripts/collect-rejections.ts --days 7 --out /tmp/alint-rejections
```

For each recurring complaint, decide: already covered by a rule (name it) · a candidate for a
new rule (with the verbatim quote and the file that would show it) · not a rule (requirement /
taste / ESLint). Keep the "candidate" list short — a rule needs recurrence and single-file
evidence.

## Segment E — promotion from real data

```bash
bun .agents/skills/alint-ruleset/scripts/pull-alint-runs.ts --days 7 --out /tmp/alint-ci
```

Read the deduplicated standing findings against the source, then apply the
[promotion gate](promotion.md#the-gate). Per rule, output one of: **promote to error** ·
**demote to warn** · **add a carve-out (then re-evaluate)** · **move to audit** · **hold (no
data)**. A rule with no organic findings is "hold", not "promote".

## Segment F — cost

```bash
# per-run usage from saved JSON, or the usage line carried on each CI run summary
bun .agents/skills/alint-ruleset/scripts/cost-report.ts <run.json> --price-in 1 --price-in-hit 0.1 --price-out 2
```

Report the CI key and the local key **separately**, and name the cause of any week-over-week
jump: a rule edit invalidating the cache, a new rule widening a scope, or a release PR doing a
cold run. See [cost.md](cost.md).

## Output — the report

Lead with the result, then the detail (business first, mechanics after). Keep it short.

```markdown
# alint 周报 — <window>

<one or two sentences: what changed for the rule set this week, and whether anything needs a decision>

## 本周期结论
- 晋升 / 降级：<rule> → <severity>（依据：<n> 条真实结果，TP/FP）
- 新规则候选：<n> 条（<names>）
- 成本：CI ¥<x>（<key>），较上周 <±%>，原因 <…>

## 需要你拍板
- <decision> — 我的建议：<…>

## 明细
### 真实数据（<window>）
| rule | 结果数 | 真/误 | 建议 |
### 新打回意见
| 类别 | 条数 | 例 | 去向 |
### 成本
| key | token | 金额 | 备注 |
```

## Non-goals

- **No whole-repo cold scan.** It is the largest cost; calibrate on samples. If a full scan is
  genuinely needed, run it as its own task and record it as a one-off.
- **No product-code edits.** A product fix that a rule surfaced gets its own PR, with
  acceptance.
- **No automatic promotion.** Recommendations only; the owner decides, and the promotion PR is
  separate.

## First run vs later runs

The first run establishes the baseline: current severities, the open candidate list, and a cost
baseline. Every later run compares against it, so always store the previous report and diffs
against it rather than re-deriving the whole picture.
