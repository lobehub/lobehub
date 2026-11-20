export interface StaticModelOption {
  label: string;
  value: string;
}

const CLAUDE_CODE_MODEL_OPTIONS: StaticModelOption[] = [
  // Aliases resolve by CLI version and provider, so do not promise a fixed version.
  { label: 'Fable', value: 'fable' },
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
];

/**
 * Display names for the aliases `static` providers accept. These track CLI
 * releases rather than the provider contract, so they stay out of
 * `@lobechat/types` alongside the capability table.
 */
const STATIC_MODEL_OPTIONS: Record<string, StaticModelOption[]> = {
  'claude-code': CLAUDE_CODE_MODEL_OPTIONS,
};

export const getStaticModelOptions = (type: string | undefined): StaticModelOption[] =>
  (type && STATIC_MODEL_OPTIONS[type]) || [];

// Display aliases only; catalog providers never use these as selectable options.
export const MODEL_LABELS: Record<string, string> = {
  'gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.6': 'GPT-5.6',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-6-astra': 'GPT-6 Astra',
  ...Object.fromEntries(
    Object.values(STATIC_MODEL_OPTIONS)
      .flat()
      .map((option) => [option.value, option.label]),
  ),
};
