import { AIChatModelCard } from '../types/aiModel';

export const n1nChatModels: AIChatModelCard[] = [
    {
        abilities: {
            functionCall: true,
            vision: true,
        },
        contextWindowTokens: 200_000,
        description: 'Claude 3.5 Sonnet delivers strong performance in reasoning, coding, and understanding.',
        displayName: 'Claude 3.5 Sonnet',
        enabled: true,
        id: 'claude-3-5-sonnet-20240620_repeat_n1n',
        type: 'chat',
    },
    {
        abilities: {
            functionCall: true,
            vision: true,
        },
        contextWindowTokens: 128_000,
        description: 'GPT-4o is OpenAI’s flagship model for complex tasks.',
        displayName: 'GPT-4o',
        enabled: true,
        id: 'gpt-4o_repeat_n1n',
        type: 'chat',
    },
    {
        abilities: {
            functionCall: true,
            vision: true,
        },
        contextWindowTokens: 1_000_000,
        description: 'Gemini 1.5 Pro is Google’s most capable AI model.',
        displayName: 'Gemini 1.5 Pro',
        enabled: true,
        id: 'gemini-1.5-pro-latest_repeat_n1n',
        type: 'chat',
    },
    {
        abilities: {
            functionCall: true,
        },
        contextWindowTokens: 64_000,
        description: 'DeepSeek-V3 is a strong open-source language model.',
        displayName: 'DeepSeek V3',
        enabled: true,
        id: 'deepseek-chat_repeat_n1n',
        type: 'chat',
    },
    {
        abilities: {
            reasoning: true,
        },
        contextWindowTokens: 64_000,
        description: 'DeepSeek-R1 is optimized for reasoning tasks.',
        displayName: 'DeepSeek R1',
        enabled: true,
        id: 'deepseek-reasoner_repeat_n1n',
        type: 'chat',
    },
];

export default n1nChatModels;
