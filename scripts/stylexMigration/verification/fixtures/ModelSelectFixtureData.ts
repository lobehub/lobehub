const notExercised = async () => {
  throw new Error('BUSINESS_MUTATION_OUTSIDE_STYLE_FIXTURE');
};

const model = (id: string, displayName: string, abilities: Record<string, boolean> = {}) => ({
  abilities,
  contextWindowTokens: 128_000,
  displayName,
  id,
});

const aiInfraState = {
  builtinAiModelList: [
    { displayName: 'Legacy Model', id: 'legacy-model', providerId: 'openai', type: 'chat' },
  ],
  enabledAiProviders: [{ id: 'openai' }, { id: 'anthropic' }],
  enabledChatModelList: [
    {
      children: [
        model('gpt-4o', 'GPT-4o', { functionCall: true, vision: true }),
        model('gpt-4o-mini', 'GPT-4o mini'),
      ],
      id: 'openai',
      name: 'OpenAI',
      source: 'builtin',
    },
    {
      children: [model('claude-sonnet', 'Claude Sonnet', { reasoning: true })],
      id: 'anthropic',
      name: 'Anthropic',
      source: 'builtin',
    },
  ],
  isInitAiProviderRuntimeState: true,
  modelRedirects: { 'openai/retired-model': 'gpt-4o' },
  toggleProviderEnabled: notExercised,
  toggleProviderModelEnabled: notExercised,
};

export const useAiInfraStore = <T>(selector: (state: typeof aiInfraState) => T): T =>
  selector(aiInfraState);

export const aiProviderSelectors = {
  enabledAsrModelList: () => [],
  enabledEmbeddingModelList: () => [],
};

export const formatTokenNumber = (value: number) => `${Math.round(value / 1000)}K`;
export const isNewReleaseDate = () => false;
