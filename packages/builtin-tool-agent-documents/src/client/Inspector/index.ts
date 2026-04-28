import type { BuiltinInspector } from '@lobechat/types';

import { AgentDocumentsApiName } from '../../types';
import { CopyDocumentInspector } from './CopyDocument';
import { CreateDocumentInspector } from './CreateDocument';
import { EditDocumentInspector } from './EditDocument';
import { ListDocumentsInspector } from './ListDocuments';
import { ModifyNodesInspector } from './ModifyNodes';
import { ReadDocumentInspector } from './ReadDocument';
import { ReadDocumentByFilenameInspector } from './ReadDocumentByFilename';
import { RemoveDocumentInspector } from './RemoveDocument';
import { RenameDocumentInspector } from './RenameDocument';
import { UpdateLoadRuleInspector } from './UpdateLoadRule';
import { UpsertDocumentByFilenameInspector } from './UpsertDocumentByFilename';

export const AgentDocumentsInspectors: Record<string, BuiltinInspector> = {
  [AgentDocumentsApiName.copyDocument]: CopyDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.createDocument]: CreateDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.editDocument]: EditDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.listDocuments]: ListDocumentsInspector as BuiltinInspector,
  [AgentDocumentsApiName.modifyNodes]: ModifyNodesInspector as BuiltinInspector,
  [AgentDocumentsApiName.readDocument]: ReadDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.readDocumentByFilename]:
    ReadDocumentByFilenameInspector as BuiltinInspector,
  [AgentDocumentsApiName.removeDocument]: RemoveDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.renameDocument]: RenameDocumentInspector as BuiltinInspector,
  [AgentDocumentsApiName.updateLoadRule]: UpdateLoadRuleInspector as BuiltinInspector,
  [AgentDocumentsApiName.upsertDocumentByFilename]:
    UpsertDocumentByFilenameInspector as BuiltinInspector,
};
