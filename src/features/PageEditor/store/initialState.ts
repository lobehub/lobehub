import { type IEditor } from '@lobehub/editor';

import { type EditLockHealth } from '@/features/EditLock';

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
  /** True until the first lock peek resolves; the editor stays read-only until then. */
  isLockPending?: boolean;
  isMetaDirty?: boolean;
  /** True when the open page belongs to a workspace (gates view-first behaviour). */
  isWorkspacePage?: boolean;
  lastSavedEmoji?: string;
  lastSavedTitle?: string;
  /** Lease expiry of the current lock holder, if known. */
  lockExpiresAt?: Date | string | null;
  /**
   * Lock health from this session's editor perspective. Drives the lost-lock
   * banner; viewers ignore it. See {@link EditLockHealth}.
   */
  lockHealth?: EditLockHealth;
  /** User id of the member currently holding the collaborative edit lock. */
  lockHolderId?: string | null;
  /**
   * Edit-session id of the member currently holding the lock, when known. Lets
   * us detect "locked by another session of the same user" (e.g. a second tab),
   * which a userId-only comparison can't see.
   */
  lockHolderOwnerId?: string | null;
  /** Edit-session id for this open page instance. */
  lockOwnerId?: string;
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
  isMetaDirty: false,
  isWorkspacePage: false,
  lockExpiresAt: null,
  lockHealth: 'healthy',
  lockHolderId: null,
  lockHolderOwnerId: null,
  lockOwnerId: undefined,
  metaSaveStatus: 'idle',
  rightPanelMode: 'copilot',
  title: undefined,
};
