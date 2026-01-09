export const systemToUserModels = new Set([
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
]);

// TODO: temporary implementation, needs to be refactored into model card display configuration
export const disableStreamModels = new Set([
  'o1',
  'o1-2024-12-17',
  'o1-pro',
  'o1-pro-2025-03-19',
  /*
  Official documentation shows no support, but actual testing shows Streaming is supported, temporarily commented out
  'o3-pro',
  'o3-pro-2025-06-10',
  */
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
]);

/**
 * models use Responses API only
 */
export const responsesAPIModels = new Set([
  'o1-pro',
  'o1-pro-2025-03-19',
  'o3-deep-research',
  'o3-deep-research-2025-06-26',
  'o3-pro',
  'o3-pro-2025-06-10',
  'o4-mini-deep-research',
  'o4-mini-deep-research-2025-06-26',
  'codex-mini-latest',
  'computer-use-preview',
  'computer-use-preview-2025-03-11',
  'gpt-5-codex',
  'gpt-5-pro',
  'gpt-5-pro-2025-10-06',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-pro-2025-12-11',
  'gpt-5.2-pro',
]);

/**
 * Regex patterns for models that support context caching (3.5+)
 */
export const contextCachingModelPatterns: RegExp[] = [
  // Claude 4.5 series - Anthropic API
  /^claude-(opus|sonnet|haiku)-4-5-/,
  // Claude 4 series - Anthropic API
  /^claude-(opus|sonnet)-4-/,
  // Claude 3.7 - Anthropic API
  /^claude-3-7-sonnet-/,
  // Claude 3.5 series - Anthropic API
  /^claude-3-5-(sonnet|haiku)-/,
  // OpenRouter format (3.5+)
  /^anthropic\/claude-(opus|sonnet|haiku)-(4\.5|4|3\.7|3\.5)/,
  /^anthropic\/claude-(4\.5|4|3\.7|3\.5)-(opus|sonnet|haiku)/,
  // AWS Bedrock format: [region.]anthropic.claude-xxx
  /anthropic\.claude-(opus|sonnet|haiku)-(4-5|4|3-7|3-5)-/,
];

export const isContextCachingModel = (model: string): boolean => {
  return contextCachingModelPatterns.some((pattern) => pattern.test(model));
};

/**
 * Regex patterns for Claude models that support thinking with tools (3.7+)
 */
export const thinkingWithToolClaudeModelPatterns: RegExp[] = [
  // Claude 4.5 series - Anthropic API
  /^claude-(opus|sonnet|haiku)-4-5-/,
  // Claude 4 series - Anthropic API
  /^claude-(opus|sonnet)-4-/,
  // Claude 3.7 - Anthropic API
  /^claude-3-7-sonnet-/,
  // OpenRouter format (3.7+)
  /^anthropic\/claude-(opus|sonnet|haiku)-(4\.5|4|3\.7)/,
  /^anthropic\/claude-(4\.5|4|3\.7)-(opus|sonnet|haiku)/,
  // AWS Bedrock format: [region.]anthropic.claude-xxx
  /anthropic\.claude-(opus|sonnet|haiku)-(4-5|4|3-7)-/,
];

export const isThinkingWithToolClaudeModel = (model: string): boolean => {
  return thinkingWithToolClaudeModelPatterns.some((pattern) => pattern.test(model));
};

/**
 * Regex patterns for Claude 4+ models that have temperature/top_p parameter conflict
 * (cannot set both temperature and top_p at the same time)
 */
export const temperatureTopPConflictModelPatterns: RegExp[] = [
  // Claude 4+ series - Anthropic API (4, 4.1, 4.5)
  /^claude-(opus|sonnet|haiku)-4/,
  // OpenRouter format
  /^anthropic\/claude-(opus|sonnet|haiku)-(4\.5|4\.1|4)/,
  /^anthropic\/claude-(4\.5|4\.1|4)-(opus|sonnet|haiku)/,
  // AWS Bedrock format: [region.]anthropic.claude-xxx
  /anthropic\.claude-(opus|sonnet|haiku)-4/,
];

export const hasTemperatureTopPConflict = (model: string): boolean => {
  return temperatureTopPConflictModelPatterns.some((pattern) => pattern.test(model));
};
