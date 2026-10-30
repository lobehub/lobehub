import type { AIChatModelCard } from '../types/aiModel';

const jzstokenChatModels: AIChatModelCard[] = [
  {
    description:
      'JZSTOKEN flagship model endpoint. Check the provider catalog for current context and pricing.',
    displayName: 'JZS Max 3.0',
    enabled: true,
    family: 'jzs',
    id: 'jzs-max-3.0',
    type: 'chat',
  },
  {
    description: 'GPT-5.6 Terra through JZSTOKEN.',
    displayName: 'GPT-5.6 Terra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-terra',
    type: 'chat',
  },
  {
    description: 'Claude Sonnet 5 through JZSTOKEN.',
    displayName: 'Claude Sonnet 5',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-5',
    id: 'claude-sonnet-5',
    type: 'chat',
  },
  {
    description: 'DeepSeek V4 Pro through JZSTOKEN.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    type: 'chat',
  },
  {
    description: 'Kimi K2.8 through JZSTOKEN.',
    displayName: 'Kimi K2.8',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'kimi-k2.8',
    type: 'chat',
  },
];

export const allModels = jzstokenChatModels;

export default allModels;
