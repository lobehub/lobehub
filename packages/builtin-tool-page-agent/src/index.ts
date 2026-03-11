// Re-export runtime types from @lobechat/editor-runtime
export { PageAgentManifest } from './manifest';
export { systemPrompt } from './systemRole';
export {
  DocumentApiName,
  type EditTitleState,
  type GetPageContentState,
  type InitDocumentState,
  type ModifyNodesState,
  PageAgentIdentifier,
  type ReplaceTextState,
} from './types';
export type {
  EditTitleArgs,
  GetPageContentArgs,
  InitDocumentArgs,
  ModifyInsertOperation,
  ModifyNodesArgs,
  ModifyOperation,
  ModifyOperationResult,
  ModifyRemoveOperation,
  ModifyUpdateOperation,
  ReplaceTextArgs,
} from '@lobechat/editor-runtime';
