import { router } from '@/libs/trpc/lambda';

import { crudProcedures } from './crud';
import { editSessionProcedures } from './editSession';
import { workspaceProcedures } from './workspace';

export const documentRouter = router({
  ...crudProcedures,
  ...editSessionProcedures,
  ...workspaceProcedures,
});
