import type { ModelProviderCard } from '@/types/llm';

// ref :https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
// ref :https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/models
// ref :https://us-west-2.console.aws.amazon.com/bedrock/home?region=us-west-2#/models
const Bedrock: ModelProviderCard = {
  chatModels: [],
  checkModel: 'anthropic.claude-instant-v1',
  description:
    'Amazon Bedrock provides enterprises with advanced language and vision models, including Anthropic Claude and Meta Llama 3.1, spanning lightweight to high-performance options for text, chat, and image tasks.',
  id: 'bedrock',
  modelsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html',
  name: 'Bedrock',
  settings: { sdkType: 'bedrock' },
  url: 'https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html',
};

export default Bedrock;
