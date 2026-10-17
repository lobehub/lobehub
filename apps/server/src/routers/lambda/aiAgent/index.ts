import { router } from '@/libs/trpc/lambda';

import { clientTaskThreadProcedures } from './clientTaskThread';
import { execProcedures } from './exec';
import { gatewayRelayProcedures } from './gatewayRelay';
import { heteroProcedures } from './hetero';
import { interventionProcedures } from './intervention';
import { operationStatusProcedures } from './operationStatus';
import { runControlProcedures } from './runControl';
import { serverDefaultHeteroProcedures } from './serverDefaultHetero';

export { bridgeLegacyResumeToSourceIntervention } from './exec';
export {
  ResumeApprovalDecisionSchema,
  ResumeToolResultSchema,
  validateResumePayload,
} from './execSchemas';
export type { AgentInterventionDispatchContext } from './interventionDispatch';
export { dispatchClaimedAgentIntervention } from './interventionDispatch';
export { resolveServerDefaultHeterogeneousCapability } from './serverDefaultHetero';

export const aiAgentRouter = router({
  ...serverDefaultHeteroProcedures,
  ...clientTaskThreadProcedures,
  ...execProcedures,
  ...operationStatusProcedures,
  ...interventionProcedures,
  ...gatewayRelayProcedures,
  ...runControlProcedures,
  ...heteroProcedures,
});
