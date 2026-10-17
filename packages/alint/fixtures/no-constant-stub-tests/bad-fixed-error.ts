import { TRPCError } from '@trpc/server';
import { expect, it } from 'vitest';

// Retired API: no input, authorization or data-dependent work in this handler.
const moveTask = async (_input: { id: string; taskId: string }) => {
  throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Project moves are disabled' });
};

// alint-expect
it('returns the disabled status from moveTask', async () => {
  await expect(moveTask({ id: 'target', taskId: 'parent' })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
    message: 'Project moves are disabled',
  });
});
