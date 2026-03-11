import type { BuiltinStreaming } from '@lobechat/types';

import { NotebookApiName } from '../../types';
import { CreateDocumentStreaming } from './CreateDocument';

/**
 * Notebook Streaming Components Registry
 *
 * Streaming components are used to render tool calls while arguments
 * are still being generated, allowing real-time feedback to users.
 */
export const NotebookStreamings: Record<string, BuiltinStreaming> = {
  [NotebookApiName.createDocument]: CreateDocumentStreaming as BuiltinStreaming,
};
