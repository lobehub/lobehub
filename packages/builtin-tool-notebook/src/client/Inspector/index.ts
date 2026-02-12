import type { BuiltinInspector } from '@lobechat/types';

import { NotebookApiName } from '../../types';
import { CreateDocumentInspector } from './CreateDocument';

/**
 * Notebook Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const NotebookInspectors: Record<string, BuiltinInspector> = {
  [NotebookApiName.createDocument]: CreateDocumentInspector as BuiltinInspector,
};
