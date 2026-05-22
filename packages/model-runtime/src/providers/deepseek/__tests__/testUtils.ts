import { expect, vi } from 'vitest';

const loadModelsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    {
      id: 'deepseek-v4-pro',
      maxOutput: 393_216,
      providerId: 'deepseek',
    },
  ]),
);

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

export const defaultOpenAIBaseURL = 'https://api.deepseek.com/v1';
export const anthropicBaseURL = 'https://api.deepseek.com/anthropic';
export const loneHighSurrogate = '\uD83D';
export const loneLowSurrogate = '\uDC1B';
export const validEmoji = '\uD83D\uDC1B';

export const expectNoLoneSurrogateEscapes = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain('\\ud83d');
  expect(serialized).not.toContain('\\udc1b');

  return serialized;
};

vi.spyOn(console, 'error').mockImplementation(() => {});
