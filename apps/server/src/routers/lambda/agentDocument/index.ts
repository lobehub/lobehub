import { router } from '@/libs/trpc/lambda';

import { documentsProcedures } from './documents';
import { skillsProcedures } from './skills';
import { toolDocumentsProcedures } from './toolDocuments';
import { vfsProcedures } from './vfs';

export const agentDocumentRouter = router({
  ...documentsProcedures,
  ...vfsProcedures,
  ...skillsProcedures,
  ...toolDocumentsProcedures,
});
