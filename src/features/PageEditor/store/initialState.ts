import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { type IEditor } from '@lobehub/editor';

import { type EditLockHealth } from '@/features/EditLock';

export type MetaSaveStatus = 'idle' | 'saving' | 'saved';
export type RightPanelMode = 'copilot' | 'history';

/** A captured body selection, tagged with the document it was taken from. */
export interface PendingCommentAnchor {
  anchor: DocumentCommentSelectionAnchor;
  documentId: string;
}

export interface PublicState {
  autoSave?: boolean;
  emoji?: string;
  knowledgeBaseId?: string;
  /**
   * Make the page meta (title + emoji) read-only even when the body is editable.
   * Used for managed docs whose identity is owned elsewhere — e.g. a skill's
   * `SKILL.md` index, where the visible name is the bundle title and renaming
   * must go through the skill APIs, never a plain document title save (which
   * would overwrite the index filename and desync the bundle).
   */
  metaReadOnly?: boolean;
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
  /**
   * Whether the comments panel beside the body is open. It is its own panel,
   * not a mode of the page-agent panel, so opening it never displaces the
   * copilot and vice versa. Not persisted: a fresh document starts closed
   * and a selection opens it on demand.
   */
  commentsPanelOpen: boolean;
  documentId: string | undefined;
  editor?: IEditor;
  /** True until the first lock peek resolves; the editor stays read-only until then. */
  isLockPending?: boolean;
  isMetaDirty?: boolean;
  /** True when the open page belongs to a workspace (gates view-first behaviour). */
  isWorkspacePage?: boolean;
  /**
   * True when the page row carries a workspaceId, private drafts included.
   * Wider than {@link isWorkspacePage}, which additionally excludes private
   * pages because they never take the collaborative edit lock.
   */
  isWorkspaceScopedPage?: boolean;
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
  /**
   * A body selection captured by the toolbar's comment action and waiting for
   * the composer to publish it. This is the one piece of state the editor
   * canvas and the comment list have to share — everything else about an
   * anchor is derived from the body's DOM inside the comment list.
   *
   * It carries its own `documentId` because this store outlives a document
   * switch (the resource manager swaps `pageId` on a mounted PageEditor): a
   * quote captured in one document must never be adopted by the next one's
   * composer, or published against it.
   */
  pendingCommentAnchor?: PendingCommentAnchor;
  /**
   * Ticks every time a selection is captured. The store compares selected
   * values by content, so two picks of the same run look identical to a
   * subscriber; this counter is what tells them apart (the composer takes
   * the caret again on every pick).
   */
  pendingCommentAnchorVersion: number;
  rightPanelMode: RightPanelMode;
}

export const initialState: State = {
  autoSave: true,
  commentsPanelOpen: false,
  documentId: undefined,
  emoji: undefined,
  // Start pending (read-only) so the editor never flashes editable before the
  // lock driver has resolved whether the page is free.
  isLockPending: true,
  isMetaDirty: false,
  isWorkspacePage: false,
  isWorkspaceScopedPage: false,
  lockExpiresAt: null,
  lockHealth: 'healthy',
  lockHolderId: null,
  lockHolderOwnerId: null,
  lockOwnerId: undefined,
  metaSaveStatus: 'idle',
  pendingCommentAnchor: undefined,
  pendingCommentAnchorVersion: 0,
  rightPanelMode: 'copilot',
  title: undefined,
};
