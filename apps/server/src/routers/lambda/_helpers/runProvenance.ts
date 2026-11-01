import { TRPCError } from '@trpc/server';

interface OperationLink {
  id: string;
  parentOperationId?: string | null;
}

/**
 * Walk an operation the caller already owns up to the root of its run.
 *
 * Work versions are keyed by the ROOT operation (`work_versions.root_operation_id`),
 * so a document written from a sub-operation has to be credited to the run that
 * contains it — that is the id a Goal harvests deliverables by. Every ancestor
 * must be owned by the caller too, otherwise a write could claim someone else's run.
 */
export const resolveRootOperation = async <T extends OperationLink>(
  findOwnOperationById: (id: string) => Promise<T | null | undefined>,
  operation: T,
): Promise<T> => {
  let rootOperation = operation;
  const visited = new Set<string>();
  while (rootOperation.parentOperationId) {
    if (visited.has(rootOperation.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid operation ancestry' });
    }
    visited.add(rootOperation.id);
    const parent = await findOwnOperationById(rootOperation.parentOperationId);
    if (!parent) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Operation ancestry is not accessible' });
    }
    rootOperation = parent;
  }
  return rootOperation;
};
