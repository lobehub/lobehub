import { router } from '@/libs/trpc/lambda';

import { agentBindingProcedures } from './agentBinding';
import { bootstrapProcedures } from './bootstrap';
import { connectorManagementProcedures } from './management';
import { oauthProcedures } from './oauth';
import { connectorReadProcedures } from './reads';
import { toolProcedures } from './tools';

export const connectorRouter = router({
  ...connectorReadProcedures,
  ...connectorManagementProcedures,
  ...agentBindingProcedures,
  ...oauthProcedures,
  ...toolProcedures,
  ...bootstrapProcedures,
});
