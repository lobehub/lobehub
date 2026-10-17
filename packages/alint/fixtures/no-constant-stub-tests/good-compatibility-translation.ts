import { expect, it } from 'vitest';

const translateLegacyTask = (input: { instruction?: string; prompt?: string }) => {
  const instruction = input.instruction ?? input.prompt;
  if (!instruction?.trim()) throw new Error('Missing task instruction');
  return { instruction };
};

it('translates old task input and rejects invalid old input', () => {
  expect(translateLegacyTask({ prompt: 'Launch' })).toEqual({ instruction: 'Launch' });
  expect(() => translateLegacyTask({ prompt: '' })).toThrow('Missing task instruction');
});
