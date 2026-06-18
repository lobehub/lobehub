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
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.2-pro-2025-12-11',
  'gpt-5.2-pro',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4-pro',
  'gpt-5.5',
  'gpt-5.5-pro',
]);

export const isGPT5ProResponsesModel = (model: string): boolean =>
  /(?:^|\/)gpt-5(?:\.\d+)?-pro(?:-|$)/.test(model);
