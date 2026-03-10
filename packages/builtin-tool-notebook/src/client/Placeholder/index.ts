import type { BuiltinPlaceholder } from '@lobechat/types';

import { NotebookApiName } from '../../types';
import { CreateDocumentPlaceholder } from './CreateDocument';

export { CreateDocumentPlaceholder } from './CreateDocument';

export const NotebookPlaceholders: Record<string, BuiltinPlaceholder> = {
  [NotebookApiName.createDocument]: CreateDocumentPlaceholder as BuiltinPlaceholder,
};
