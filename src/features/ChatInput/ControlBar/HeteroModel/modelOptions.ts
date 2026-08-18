export interface StaticModelOption {
  label: string;
  value: string;
}

const CLAUDE_CODE_MODEL_OPTIONS: StaticModelOption[] = [
  { label: 'Fable 5', value: 'fable' },
  { label: 'Opus 4.8', value: 'opus' },
  { label: 'Sonnet 4.6', value: 'sonnet' },
  { label: 'Haiku 4.5', value: 'haiku' },
];

const CODEX_MODEL_OPTIONS: StaticModelOption[] = [
  { label: 'GPT-5.6 Sol', value: 'gpt-5.6-sol' },
  { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra' },
  { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
  { label: 'GPT-5.5', value: 'gpt-5.5' },
  { label: 'GPT-5.4', value: 'gpt-5.4' },
  { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini' },
  { label: 'GPT-5.3 Codex Spark', value: 'gpt-5.3-codex-spark' },
];

/**
 * Display names for the aliases `static` providers accept. These track CLI
 * releases rather than the provider contract, so they stay out of
 * `@lobechat/types` alongside the capability table.
 */
const STATIC_MODEL_OPTIONS: Record<string, StaticModelOption[]> = {
  'claude-code': CLAUDE_CODE_MODEL_OPTIONS,
  'codex': CODEX_MODEL_OPTIONS,
};

export const getStaticModelOptions = (type: string | undefined): StaticModelOption[] =>
  (type && STATIC_MODEL_OPTIONS[type]) || [];

export const MODEL_LABELS: Record<string, string> = {
  'gpt-5.6': 'GPT-5.6',
  ...Object.fromEntries(
    Object.values(STATIC_MODEL_OPTIONS)
      .flat()
      .map((option) => [option.value, option.label]),
  ),
};
