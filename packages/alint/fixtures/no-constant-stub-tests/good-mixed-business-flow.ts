import { expect, it } from 'vitest';

const createTask = (instruction: string) => {
  if (!instruction.trim()) throw new Error('Missing task instruction');
  return { instruction, status: 'backlog' };
};
const retiredTransfer = () => ({ enabled: false });

it('keeps task creation working while the old transfer is retired', () => {
  const task = createTask('Launch');
  expect(task).toEqual({ instruction: 'Launch', status: 'backlog' });
  expect(retiredTransfer()).toEqual({ enabled: false });
});
