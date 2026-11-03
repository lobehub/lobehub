# Authoring a rule

A rule is a prompt plus a structured-output schema. Declarative rules carry their prompt in
`rule.alint.toml` and need no TypeScript; `builtInAgent = "basic-structured"` runs them.

## Anatomy

```toml
name = "ui-button-hierarchy"                 # must equal the directory name
builtInAgent = "basic-structured"
instruction = """
You are reviewing one React component file from LobeHub's web client. …   # role + surface

Team rule, distilled from the product owner's review rejections ("按钮用 filled 而不是 primary", …):
…                                                                          # the standard, in the owner's words

Report ONLY these three patterns …                                        # what to report, when it is decidable
1. … Anchor on the line of the button's opening tag.                       # anchor per pattern

Do not report:                                                             # carve-outs first
- …

If an exclusion applies, return no finding. If uncertain, use low confidence.
"""
```

The instruction is written to the model as a reviewer, not as a summary. It must state:
what to report, **which line to anchor on**, what the message must name, what the suggestion
must contain, and the explicit **do not report** list. The carve-outs are where the false
positives live — write them before the report list, not after.

## Two homes, two prefixes

| Kind             | Rule path                            | Fixtures path                            | Prefix    |
| ---------------- | ------------------------------------ | ---------------------------------------- | --------- |
| Repo-wide        | `packages/alint/rules/<name>/`       | `packages/alint/fixtures/<name>/`        | `lobehub` |
| One package only | `packages/<pkg>/alint/rules/<name>/` | `packages/<pkg>/alint/fixtures/<name>/`  | `<pkg>…`  |

A package-level rule is only ever scoped to its package (`hetero/*` rules live next to
`heterogeneous-agents`). Put a rule in `packages/alint` only when more than one package or
`src/` needs it.

## Scoping — in the config, never in the rule

Register scope as a `[[config.group]]` in the root config. A group can carry `ignores`,
`files`, `plugins` and `rules`, and may extend another group (`extends`).

```toml
# PR check — alint.config.toml
[[config.group]]
files = ["src/**/*.tsx"]
ignores = ["**/*.test.tsx"]

[config.group.plugins]
lobehub = "./packages/alint/rules"

[config.group.rules]
"lobehub/ui-button-hierarchy" = "warn"
```

Never scope a rule with `includeFiles` inside `rule.alint.toml`: it only filters reports, so
every matched file still runs (double the jobs) and the rule is marked uncacheable. Give each
fixture directory its own group so a fixture meets only its own rule.

## Fixtures

- One dir per rule, `bad-*` and `good-*` files, short and realistic (a real pattern, not a
  minimal repro).
- A `bad-*` file marks the expected finding with `// alint-expect` **on its own line above**
  the line the finding must anchor to (`{/* alint-expect */}` inside JSX children). The test
  accepts a hit within ±1 line.
- Every carve-out in the instruction gets a `good-*` fixture taken from a real false positive.
- `packages/alint/fixtures.test.ts` asserts both directions: `good-*` produces nothing,
  `bad-*` produces a finding near each marker, and a fixture only ever meets its own rule.

## Add-a-rule sequence

```bash
# 1. write rules/<name>/rule.alint.toml
# 2. add the scope group in alint.config.toml and a fixture group for fixtures/<name>/**
# 3. add fixtures/<name>/{bad-*,good-*}
bun run alint plugin install                                   # register the rule directory
rm -rf .alintcache                                             # an edited rule must not replay old results
cd packages/alint && bunx vitest run fixtures.test.ts          # skips silently without .alint/config.toml
# 4. run it over a few dozen real files and read every finding before enabling the scope
```

The instruction is source, not documentation: changing it changes results. After any edit,
clear the cache and re-run the fixtures cold.

## Severity

`error` is reserved for rules measured at zero false positives on real PRs, because an error
turns the ALint check red. Everything else is `warn`. New rules start at `warn`; fixture
groups stay `warn`. Promotion is a separate, evidence-based step — see
[promotion.md](promotion.md).
