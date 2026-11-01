import { mergeRouters } from '@/libs/trpc/lambda';

import { clientTaskThreadRouter } from './clientTaskThread';
import { execRouter } from './exec';
import { gatewayRelayRouter } from './gatewayRelay';
import { heteroRouter } from './hetero';
import { interventionRouter } from './intervention';
import { operationStatusRouter } from './operationStatus';
import { runControlRouter } from './runControl';
import { serverDefaultHeteroRouter } from './serverDefaultHetero';

export { bridgeLegacyResumeToSourceIntervention } from './exec';
export {
  ResumeApprovalDecisionSchema,
  ResumeToolResultSchema,
  validateResumePayload,
} from './execSchemas';
export type { AgentInterventionDispatchContext } from './interventionDispatch';
export { dispatchClaimedAgentIntervention } from './interventionDispatch';
export { resolveServerDefaultHeterogeneousCapability } from './serverDefaultHetero';

export const aiAgentRouter = mergeRouters(
  serverDefaultHeteroRouter,
  clientTaskThreadRouter,
  execRouter,
  operationStatusRouter,
  interventionRouter,
  gatewayRelayRouter,
  runControlRouter,
  heteroRouter,
);
