---
name: model-bank-metadata
description: 'Backfill and maintain model-bank metadata (knowledgeCutoff, family, generation). Use when adding models, fixing cutoff/family data, running a metadata sweep across aiModels providers, or researching official knowledge cutoffs.'
user-invocable: false
---

# Model-Bank Metadata (knowledgeCutoff / family / generation)

How to populate and maintain the three structured metadata fields on `packages/model-bank/src/aiModels/*.ts` model cards, at single-model scale (new model PR) or repo-wide scale (sweep across \~80 provider files / \~1900 entries).

## Field semantics

| Field             | Format                                                                              | Meaning                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledgeCutoff` | `'YYYY-MM'` (or `'YYYY'` if only the year is published)                             | World-knowledge cutoff. When a vendor distinguishes a **"reliable knowledge cutoff"** from the broader training-data cutoff (Anthropic does), always use the **reliable** one.          |
| `family`          | lowercase slug (`claude`, `gpt`, `o-series`, `qwen`, `deepseek`, `llama`, `glm`, …) | Model lineage, finer than `organization`. Lets the UI group models and match the same model across aggregator providers.                                                                |
| `generation`      | family slug + version (`claude-4.6`, `gpt-5.2`, `qwen3.5`, `llama-3.1`)             | Generation within the family. Only set when confidently derivable from the model line's naming. Rolling aliases (`qwen-max`, `deepseek-chat`, `gemini-flash-latest`) get `family` only. |

All three are optional. **The cardinal rule: only fill what an authoritative source states or naming rules derive — never guess.** An empty field is correct for vendors that publish nothing.

No DB migration is ever needed for these: builtin models are merged from model-bank at read time (`repositories/aiInfra/index.ts` spreads the whole card), so new card fields flow to the client automatically.

## Sourcing rules for knowledgeCutoff

Accept only:

- Vendor official docs (platform.openai.com / developers.openai.com, docs.x.ai, ai.google.dev, docs.anthropic.com / platform.claude.com)
- Official Hugging Face org model cards (huggingface.co/meta-llama/..., etc.)
- Official tech reports / system cards / launch blog posts

Reject:

- **Third-party aggregator sites** (aiknowledgecutoff.com and similar) — proven to copy one model's value across a whole family. A Cohere sweep once claimed `2024-06` for four distinct base models; none of the cited Cohere pages said that, and the only cutoff Cohere actually publishes is Feb 2023 for the 08-2024 Command R/R+ refresh.
- **AWS Bedrock model cards as sole source** — proven to conflate launch date with knowledge cutoff (DeepSeek R1's card lists both as "Jan 2025"). If Bedrock is the only place a value appears, leave the field empty.
- Inference from `releasedAt` — a release date is not a cutoff.

Variant inheritance: dated snapshots (`-2024-08-06`), speed/price tiers of the same checkpoint, quantizations (`-fp8`, `-awq`), context-length variants (`-32k`), ollama `:NNb` tags, and cloud-prefixed ids (`anthropic.`/`us.`/`global.` Bedrock ids) share their base model's cutoff. **Distills do not inherit** from teacher or base — use the distill's own published value or leave empty. **Sizes within one generation can genuinely differ**: Llama 3 8B is Mar 2023 while 70B is Dec 2023 (per Meta's own card) — don't "fix" that to one family-wide value.

Vendors that publish no cutoffs (leave empty, don't chase): Qwen, DeepSeek, GLM/Zhipu, ERNIE, Doubao, Hunyuan, SenseNova, Spark, MiniMax, StepFun, Yi (mostly), Moonshot.

Known per-vendor footguns:

- **Anthropic**: Opus 4.6 reliable cutoff is `2025-05`, Sonnet 4.6 is `2025-08` — easy to swap. Claude 3.7 is `2024-10` (system card: trained through Nov 2024, knowledge cutoff end of Oct 2024). Cite system cards / the models overview, not the Help Center article (a living page that drops retired models — citation rot).
- **xAI**: docs.x.ai has one blanket sentence covering grok-3/grok-4; mini variants are not named there. Grok 4.20/4.3 have no official cutoff anywhere.
- **OpenAI**: per-model docs pages (developers.openai.com/api/docs/models/<id>) state cutoffs explicitly, including snapshot differences (gpt-4-1106-preview `2023-04` vs gpt-4-0125-preview `2023-12`).

## family/generation derivation

Rule-based, no research needed: `scripts/derive-family.ts` holds the per-family regex rules. Traps already encoded there — keep them when extending:

- Date suffixes are not versions: `claude-sonnet-4-20250514` is generation `claude-4`, not `claude-4.2`.
- Size suffixes are not versions: `llama-3-8b` → `llama-3` (not `llama-3.8`); `gemma-7b-it` is **gemma-1** (not gemma-7).
- Vendor spelling variants: `qwen2p5` = qwen2.5, `llama-v3p1` = llama-3.1, ollama `:NNb` tags, Bedrock `us.`/`global.`/`anthropic.` prefixes.
- `claude-X.0` normalizes to `claude-X`.
- Fable/Mythos-class ids (`claude-fable-5`) don't match the opus/sonnet/haiku regex — they are the Mythos class — `family: 'claude-mythos'`, `generation: 'mythos-5'` (set manually; the launch page calls Fable 5 "the generally available Mythos-class model").

## Repo-wide sweep workflow

1. **Extract ids**: `bun .agents/skills/model-bank-metadata/scripts/extract-model-ids.ts` → unique normalized chat-model ids (normalization = last path segment, lowercased). Non-chat types (image/video/embedding/tts) have no knowledge cutoff — skip them.
2. **Research (multi-agent)**: chunk ids by family (≤50 per chunk) and fan out one research agent per chunk (Workflow tool), each returning `{id, cutoff, source}` with the sourcing rules above baked into the prompt, **plus** one adversarial verify agent per chunk that re-fetches cited sources and refutes unsupported claims. The verify pass is load-bearing: it caught the Cohere aggregator copy-paste and the AWS launch-date conflation.
3. **Policy filter**: before applying, drop entries whose only source is a rejected category (check the returned `sources` map — e.g. drop everything sourced to aws.amazon.com).
4. **Apply**: `bun scripts/apply-cutoffs.ts <map.json>` and `bun scripts/apply-family.ts <map.json>` (run from repo root). Both are idempotent codemods keyed on normalized id — aggregator providers get the same values automatically; entries that already have the field are skipped. They rely on the uniform prettier formatting of the data files (entries start `  {` / end `  },`, fields at 4-space indent).
5. **Verify**: `cd packages/model-bank && bunx vitest run src/aiModels/__tests__/index.test.ts && bunx tsc --noEmit`.

## Maintenance rules

- **New model PRs** should fill all three fields inline, citing the official source in the PR body (see the Anthropic entries in `anthropic.ts` for reference values).
- **After resolving merge conflicts** in model-bank data files, sanity-check that metadata didn't vanish: `git grep -c knowledgeCutoff -- 'packages/model-bank/src/aiModels/*.ts'` before vs after. A three-way stack of model PRs once silently dropped all 10 Anthropic cutoffs during conflict resolution.
- Dirty ids exist in aggregator data (a sambanova id once carried a trailing tab). The codemods match ids verbatim — if a map key won't apply, check for invisible characters before assuming the model is missing.
