import type { AgentOperationModel } from '@/database/models/agentOperation';

import type { VerifyStatusService } from './statusService';

/** Bound on the parent chain walked from a repair round. */
const MAX_OPERATION_ANCESTORS = 32;

/** Collapse every transient `repairing` marker left along a bounded repair chain. */
export const recomputeRepairAncestors = async (
  operationModel: AgentOperationModel,
  statusService: VerifyStatusService,
  operationId: string,
) => {
  const visited = new Set<string>();
  let current = await operationModel.findById(operationId);
  let depth = 0;

  while (current?.parentOperationId && depth < MAX_OPERATION_ANCESTORS) {
    const parentOperationId = current.parentOperationId;
    if (visited.has(parentOperationId)) break;
    visited.add(parentOperationId);

    await statusService.recompute(parentOperationId);
    current = await operationModel.findById(parentOperationId);
    depth += 1;
  }
};
