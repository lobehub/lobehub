import { mergeRouters } from '@/libs/trpc/lambda';

import { documentsRouter } from './documents';
import { skillsRouter } from './skills';
import { toolDocumentsRouter } from './toolDocuments';
import { vfsRouter } from './vfs';

export const agentDocumentRouter = mergeRouters(
  documentsRouter,
  vfsRouter,
  skillsRouter,
  toolDocumentsRouter,
);
