import { router } from '@/libs/trpc/lambda';

import { goalGraphEditProcedures } from '../goalGraphEdit';
import { configurationProcedures } from './configuration';
import { creationProcedures } from './creation';
import { lifecycleProcedures } from './lifecycle';
import { planningProcedures } from './planning';
import { readProcedures } from './reads';

export const goalRouter = router({
  ...lifecycleProcedures,
  ...planningProcedures,
  ...goalGraphEditProcedures,
  ...creationProcedures,
  ...configurationProcedures,
  ...readProcedures,
});
