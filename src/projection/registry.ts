import type { ProjectionIndex, ProjectionRecord, ProjectionSnapshot } from '@lobechat/types';

import { isHomeIndex, isHomeSnapshot } from './modules/home/validators';
import { createProjectionRepository } from './persistence/repository';
import { isProjectionRecord } from './records/validators';

export const projectionRepository = createProjectionRepository<
  ProjectionRecord,
  ProjectionIndex,
  ProjectionSnapshot
>({
  isRecord: isProjectionRecord,
  isIndex: isHomeIndex,
  isSnapshot: isHomeSnapshot,
});
