import { deepseek } from 'model-bank';

/**
 * The canonical Flash alias needs context safeguards before provider catalogs
 * catch up with the release. This does not add a self-hosted model card.
 * @see https://api-docs.deepseek.com/api/create-chat-completion/
 * @see https://api-docs.deepseek.com/quick_start/pricing/
 */
export const deepseekRuntimeModels: typeof deepseek = [
  ...deepseek,
  ...(deepseek.some((model) => model.id === 'deepseek-flash')
    ? []
    : [
        {
          contextWindowTokens: 1_000_000,
          id: 'deepseek-flash',
          maxOutput: 393_216,
          type: 'chat' as const,
        },
      ]),
];
