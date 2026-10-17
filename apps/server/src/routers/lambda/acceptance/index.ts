import { router } from '@/libs/trpc/lambda';

import { bundleProcedures } from './bundle';
import { deliveryLinksProcedures } from './deliveryLinks';
import { flowProcedures } from './flow';
import { listManagementProcedures } from './listManagement';
import { reviewProcedures } from './review';
import { subjectProcedures } from './subject';

export { resolveAcceptanceForWrite } from './procedures';

export const acceptanceRouter = router({
  ...reviewProcedures,
  ...flowProcedures,
  ...deliveryLinksProcedures,
  ...subjectProcedures,
  ...bundleProcedures,
  ...listManagementProcedures,
});
