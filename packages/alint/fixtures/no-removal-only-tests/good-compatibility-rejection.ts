import { expect, it } from 'vitest';

const legacyCreateTask = (input: { instruction?: string; prompt?: string }) => {
  const instruction = input.instruction ?? input.prompt;
  if (!instruction?.trim()) throw new Error('Missing task instruction');
  return { instruction };
};

it('translates supported legacy input and rejects invalid input', () => {
  expect(legacyCreateTask({ prompt: 'Launch' })).toEqual({ instruction: 'Launch' });
  expect(() => legacyCreateTask({ prompt: '' })).toThrow('Missing task instruction');
});
