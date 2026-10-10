import { TRPCError } from '@trpc/server';
import { expect, it } from 'vitest';

const requestCompletion = (project: { status: string }) => {
  if (project.status !== 'active') {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Project must be active' });
  }
  return { ...project, status: 'reviewing' };
};

it('rejects completion for a canceled project', () => {
  expect(() => requestCompletion({ status: 'canceled' })).toThrow('Project must be active');
});
