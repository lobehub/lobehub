/**
 * Canonical model id → knowledge cutoff (`YYYY-MM`), sourced from official provider
 * documentation / model cards. Same semantics as `AIBaseModelCard.knowledgeCutoff`:
 * when a provider distinguishes a "reliable knowledge cutoff" from the broader
 * training-data cutoff (e.g. Anthropic), the reliable one is used.
 *
 * Keys must stay in normal form (`normalizeModelIdForCutoff(key) === key`) so every
 * entry stays reachable — guarded by tests. Providers that don't publish knowledge
 * cutoffs (DeepSeek, Qwen, GLM, Kimi, MiniMax, Mistral, …) are intentionally absent:
 * leaving the field empty beats guessing.
 */
export const MODEL_KNOWLEDGE_CUTOFFS: Record<string, string> = {
  // ────────────── Anthropic — https://docs.anthropic.com (models overview) ──────────────
  'claude-3-5-haiku': '2024-07',
  'claude-3-5-sonnet': '2024-04',
  'claude-3-7-sonnet': '2024-10',
  'claude-3-haiku': '2023-08',
  'claude-3-opus': '2023-08',
  'claude-3-sonnet': '2023-08',
  'claude-fable-5': '2026-01',
  'claude-haiku-4-5': '2025-02',
  'claude-opus-4': '2025-01',
  'claude-opus-4-1': '2025-01',
  'claude-opus-4-5': '2025-05',
  'claude-opus-4-6': '2025-05',
  'claude-opus-4-7': '2026-01',
  'claude-opus-4-8': '2026-01',
  'claude-sonnet-4': '2025-01',
  'claude-sonnet-4-5': '2025-01',
  'claude-sonnet-4-6': '2025-05',

  // ────────────── OpenAI — https://developers.openai.com/api/docs/models ──────────────
  'gpt-3.5-turbo': '2021-09',
  'gpt-4': '2023-12',
  'gpt-4-turbo': '2023-12',
  'gpt-4.1': '2024-06',
  'gpt-4.1-mini': '2024-06',
  'gpt-4.1-nano': '2024-06',
  'gpt-4.5': '2023-10',
  'gpt-4o': '2023-10',
  'gpt-4o-mini': '2023-10',
  'gpt-5': '2024-09',
  'gpt-5-chat': '2024-09',
  'gpt-5-codex': '2024-09',
  'gpt-5-mini': '2024-05',
  'gpt-5-nano': '2024-05',
  'gpt-5-pro': '2024-09',
  'gpt-5.1': '2024-09',
  'gpt-5.1-chat': '2024-09',
  'gpt-5.1-codex': '2024-09',
  'gpt-5.1-codex-max': '2024-09',
  'gpt-5.1-codex-mini': '2024-09',
  'gpt-5.2': '2025-08',
  'gpt-5.2-chat': '2025-08',
  'gpt-5.2-codex': '2025-08',
  'gpt-5.2-pro': '2025-08',
  'gpt-5.3-chat': '2025-08',
  'gpt-5.3-codex': '2025-08',
  'gpt-5.4': '2025-08',
  'gpt-5.4-mini': '2025-08',
  'gpt-5.4-nano': '2025-08',
  'gpt-5.4-pro': '2025-08',
  'gpt-5.5': '2025-12',
  'gpt-5.5-pro': '2025-12',
  'gpt-oss-120b': '2024-06',
  'gpt-oss-20b': '2024-06',
  'o1': '2023-10',
  'o1-mini': '2023-10',
  'o1-pro': '2023-10',
  'o3': '2024-06',
  'o3-deep-research': '2024-06',
  'o3-mini': '2023-10',
  'o3-pro': '2024-06',
  'o4-mini': '2024-06',
  'o4-mini-deep-research': '2024-06',

  // ────────────── Google — https://ai.google.dev/gemini-api/docs/models ──────────────
  'gemini-2.0-flash': '2024-08',
  'gemini-2.0-flash-lite': '2024-08',
  'gemini-2.5-flash': '2025-01',
  'gemini-2.5-flash-lite': '2025-01',
  'gemini-2.5-pro': '2025-01',
  'gemini-3-flash': '2025-01',
  'gemini-3-pro': '2025-01',
  'gemini-3.1-flash-lite': '2025-01',
  'gemini-3.1-pro': '2025-01',
  'gemini-3.5-flash': '2025-01',
  'gemma-4-26b-a4b-it': '2025-01',
  'gemma-4-31b-it': '2025-01',

  // ────────────── xAI — https://docs.x.ai/developers/models ──────────────
  'grok-3': '2024-11',
  'grok-3-mini': '2024-11',
  'grok-4': '2024-11',
  'grok-4-0709': '2024-11',
  'grok-4.3': '2025-12',

  // ────────────── Meta Llama — official model cards (data freshness) ──────────────
  'llama-3-1-8b-instruct': '2023-12',
  'llama-3-3-70b-instruct': '2023-12',
  'llama-3-70b-instruct': '2023-12',
  'llama-3-8b-instruct': '2023-03',
  'llama-3.1-405b-instruct': '2023-12',
  'llama-3.1-70b-instruct': '2023-12',
  'llama-3.1-8b-instant': '2023-12',
  'llama-3.1-8b-instruct': '2023-12',
  'llama-3.3-70b-instruct': '2023-12',
  'llama-3.3-70b-versatile': '2023-12',
  'llama-4-maverick': '2024-08',
  'llama-4-maverick-17b-128e-instruct': '2024-08',
  'llama-4-scout': '2024-08',
  'llama-4-scout-17b-16e-instruct': '2024-08',
  // Bedrock spellings (after vendor prefix / version suffix normalization)
  'llama3-1-405b-instruct': '2023-12',
  'llama3-1-70b-instruct': '2023-12',
  'llama3-1-8b-instruct': '2023-12',
  'llama3-70b-instruct': '2023-12',
  'llama3-8b-instruct': '2023-03',

  // ────────────── Amazon Nova — AWS Bedrock model cards ──────────────
  'nova-lite': '2024-10',
  'nova-micro': '2024-10',
  'nova-pro': '2024-10',

  // ────────────── Cohere — https://docs.cohere.com (per-model spec cards) ──────────────
  'command-a': '2024-06',
  'command-a-03-2025': '2024-06',
  'command-r-08-2024': '2024-06',
  'command-r-plus-08-2024': '2024-06',
  'command-r7b-12-2024': '2024-06',
};

// serving variants that reuse the same weights, e.g. `-thinking`, `-latest`, `-fp8-fast`
const VARIANT_SUFFIX_REGEX = /-(thinking|fast|beta|latest|preview|fp8)$/;
// dated snapshots (`-20250929`, `-2024-11-20`), `-06-17` style preview dates, `-001` revisions
const DATE_SUFFIX_REGEX = /-(\d{8}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|00\d)$/;

/**
 * Reduce a provider-specific model id to the canonical form used as
 * `MODEL_KNOWLEDGE_CUTOFFS` keys, e.g.
 * `global.anthropic.claude-opus-4-5-20251101-v1:0` → `claude-opus-4-5`,
 * `openai/gpt-5.2-chat` → `gpt-5.2-chat`, `gpt-oss:120b` → `gpt-oss-120b`.
 */
export const normalizeModelIdForCutoff = (modelId: string): string => {
  let id = modelId.toLowerCase().trim();

  // aggregator path prefixes: `openai/gpt-5`, `@cf/meta/llama-...`
  id = id.split('/').at(-1)!;
  // ollama-style size tag (`gpt-oss:120b`) and bedrock minor version (`-v1:0`)
  id = id.replace(':', '-');
  // bedrock region/vendor prefixes and azure `Meta-Llama-...`
  id = id
    .replace(/^(us|eu|apac|global)\./, '')
    .replace(/^(ai21|amazon|anthropic|cohere|meta|mistral)\./, '')
    .replace(/^meta-/, '');
  // bedrock version suffix, with `:` already mapped to `-`: `-v1`, `-v1-0`
  id = id.replace(/-v\d+(-\d+)?$/, '');

  // peel stacked suffixes until stable: `claude-opus-4-1-20250805-thinking`,
  // `gemini-2.5-flash-preview-04-17`, `llama-3.1-8b-instruct-fp8-fast`
  let previous: string;
  do {
    previous = id;
    id = id.replace(VARIANT_SUFFIX_REGEX, '').replace(DATE_SUFFIX_REGEX, '');
  } while (id !== previous);

  // claude version spellings diverge across aggregators: `claude-sonnet-4.6` ↔ `claude-sonnet-4-6`
  if (id.startsWith('claude')) id = id.replaceAll('.', '-');

  return id;
};

/**
 * Look up the knowledge cutoff for any provider-specific model id.
 * Returns `undefined` when the model (or its provider) has no documented cutoff.
 */
export const getModelKnowledgeCutoff = (modelId: string): string | undefined =>
  MODEL_KNOWLEDGE_CUTOFFS[modelId] ?? MODEL_KNOWLEDGE_CUTOFFS[normalizeModelIdForCutoff(modelId)];
