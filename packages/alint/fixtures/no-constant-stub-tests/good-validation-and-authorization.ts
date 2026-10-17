import { TRPCError } from '@trpc/server';
import { expect, it, vi } from 'vitest';

const writeTask = async (
  input: { instruction: string; role: string },
  save: () => Promise<void>,
) => {
  if (input.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN' });
  if (!input.instruction.trim()) throw new TRPCError({ code: 'BAD_REQUEST' });
  await save();
};

it('prevents viewer writes', async () => {
  const save = vi.fn();
  await expect(writeTask({ instruction: 'Launch', role: 'viewer' }, save)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect(save).not.toHaveBeenCalled();
});

it('rejects empty instructions', async () => {
  await expect(writeTask({ instruction: ' ', role: 'owner' }, vi.fn())).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
