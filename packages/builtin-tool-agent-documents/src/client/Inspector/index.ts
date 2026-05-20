import type { BuiltinInspector } from '@lobechat/types';

import { AgentDocumentsApiName } from '../../types';
import { CopyDocumentInspector } from './CopyDocument';
import { CreateDocumentInspector } from './CreateDocument';
import { ListDocumentsInspector } from './ListDocuments';
import { ModifyNodesInspector } from './ModifyNodes';
import { ReadDocumentInspector } from './ReadDocument';
import { RemoveDocumentInspector } from './RemoveDocument';
import { RenameDocumentInspector } from './RenameDocument';
import { ReplaceDocumentContentInspector } from './ReplaceDocumentContent';
import { UpdateLoadRuleInspector } from './UpdateLoadRule';

export const AgentDocumentsInspectors: Record<string, BuiltinInspector> = {
  [AgentDocumentsApiName.copyDocument]: CopyDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.createDocument]: CreateDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.listDocuments]: ListDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.modifyNodes]: ModifyNodesInspector as BuiltinInspector,
  [AgentDocumentsApiName.readDocument]: ReadDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.removeDocument]: RemoveDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.renameDocument]: RenameDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.replaceDocumentContent]:
    ReplaceDocumentContentInspector as BuiltinInspector,
  [AgentDocumentsApiName.updateLoadRule]: UpdateLoadRuleInspector as BuiltinInspector,
};
