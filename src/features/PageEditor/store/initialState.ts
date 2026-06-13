import { type IEditor } from '@lobehub/editor';

export type MetaSaveStatus = 'idle' | 'saving' | 'saved';
export type RightPanelMode = 'copilot' | 'history';

export interface PublicState {
  autoSave?: boolean;
  emoji?: string;
  knowledgeBaseId?: string;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onEmojiChange?: (emoji: string | undefined) => void;
  onSave?: () => void;
  onTitleChange?: (title: string) => void;
  parentId?: string;
  title?: string;
}

export interface State extends PublicState {
  documentId: string | undefined;
  editor?: IEditor;
  /** True when another workspace member is actively editing this page. */
  isLockedByOther?: boolean;
  /** True until the first lock peek resolves; the editor stays read-only until then. */
  isLockPending?: boolean;
  isMetaDirty?: boolean;
  /** True when the open page belongs to a workspace (gates view-first behaviour). */
  isWorkspacePage?: boolean;
  lastSavedEmoji?: string;
  lastSavedTitle?: string;
  /** User id of the member currently holding the collaborative edit lock. */
  lockHolderId?: string | null;
  metaSaveStatus?: MetaSaveStatus;
  rightPanelMode: RightPanelMode;
}

export const initialState: State = {
  autoSave: true,
  documentId: undefined,
  emoji: undefined,
  // Start pending (read-only) so the editor never flashes editable before the
  // lock driver has resolved whether the page is free.
  isLockPending: true,
  isLockedByOther: false,
  isMetaDirty: false,
  isWorkspacePage: false,
  lockHolderId: null,
  metaSaveStatus: 'idle',
  rightPanelMode: 'copilot',
  title: undefined,
};
