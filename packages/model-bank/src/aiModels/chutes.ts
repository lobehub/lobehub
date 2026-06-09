import type { AIChatModelCard } from '../types/aiModel';

// ref https://chutes.ai/app/chute?type=llm

const chutesChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 64_000,
    description:
      'DeepSeek-V3.2-TEE runs in a Trusted Execution Environment on Bittensor Subnet 64, providing verifiable private inference with state-of-the-art performance.',
    displayName: 'DeepSeek-V3.2-TEE',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3-0324',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Qwen3-32B-TEE runs in a Trusted Execution Environment on Bittensor Subnet 64, offering high-quality reasoning with privacy guarantees.',
    displayName: 'Qwen3-32B-TEE',
    enabled: true,
    id: 'Qwen/Qwen3-32B',
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      'Kimi-K2.5-TEE runs in a Trusted Execution Environment on Bittensor Subnet 64, providing a large context window with secure decentralized inference.',
    displayName: 'Kimi-K2.5-TEE',
    enabled: true,
    id: 'moonshotai/Kimi-K2-Instruct',
    type: 'chat',
  },
];

export const allModels = [...chutesChatModels];

export default allModels;
