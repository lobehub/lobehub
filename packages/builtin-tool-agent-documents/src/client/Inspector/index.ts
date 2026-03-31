import type { BuiltinInspector } from '@lobechat/types';

import { AgentDocumentsApiName } from '../../types';
import { AgentDocumentsInspector } from './AgentDocumentsInspector';

export const AgentDocumentsInspectors: Record<string, BuiltinInspector> = {
  [AgentDocumentsApiName.createDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.copyDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.editDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.readDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.removeDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.renameDocument]: AgentDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.updateLoadRule]: AgentDocumentsInspector as BuiltinInspector,
};
