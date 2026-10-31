import { mergeRouters } from '@/libs/trpc/lambda';

import { bundleRouter } from './bundle';
import { collaborationRouter } from './collaboration';
import { deliveryLinksRouter } from './deliveryLinks';
import { flowRouter } from './flow';
import { listManagementRouter } from './listManagement';
import { repairRouter } from './repair';
import { reviewRouter } from './review';
import { subjectRouter } from './subject';

export { resolveAcceptanceForWrite } from './procedures';

export const acceptanceRouter = mergeRouters(
  reviewRouter,
  repairRouter,
  flowRouter,
  deliveryLinksRouter,
  subjectRouter,
  bundleRouter,
  collaborationRouter,
  listManagementRouter,
);
