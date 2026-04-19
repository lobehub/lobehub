import type { BuiltinStreaming } from '@lobechat/types';

import { AgentDocumentsApiName } from '../../types';
import { CreateDocumentStreaming } from './CreateDocument';

export const AgentDocumentsStreamings: Record<string, BuiltinStreaming> = {
  [AgentDocumentsApiName.createDocument]: CreateDocumentStreaming as BuiltinStreaming,
};
