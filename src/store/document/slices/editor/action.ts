'use client';

import type { IEditor } from '@lobehub/editor';
import type { EditorState as LobehubEditorState } from '@lobehub/editor/react';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';
import type { StoreSetter } from '@/store/types';
import { composeSkillMarkdown, parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';
import type { DocumentDispatch } from './reducer';
import { documentReducer } from './reducer';

const n = setNamespace('document/editor');

/**
 * Metadata passed in at save time (not stored in editor state)
 */
export interface SaveMetadata {
  emoji?: string;
  title?: string;
}

export interface SaveExecutionOptions {
  restoreFromHistoryId?: string;
  saveSource?: 'autosave' | 'manual' | 'restore' | 'system' | 'llm_call';
}

export interface RemoteDocumentRow {
  content?: string | null;
  editorData?: unknown;
  updatedAt: Date | string;
}

export type ReconcileResult = 'unchanged' | 'rebased' | 'adopted';

type Setter = StoreSetter<DocumentStore>;
export const createEditorSlice = (set: Setter, get: () => DocumentStore, _api?: unknown) =>
  new EditorActionImpl(set, get, _api);

export class EditorActionImpl {
  readonly #get: () => DocumentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => DocumentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  private getPersistedMarkdown = (documentId: string | undefined, markdown: string): string => {
    if (!documentId) return markdown;

    const doc = this.#get().documents[documentId];
    if (doc?.contentFormat !== 'skillMarkdown') return markdown;

    return composeSkillMarkdown(doc.skillFrontmatter, markdown);
  };

  getEditorContent = (): { editorData: any; markdown: string } | null => {
    const { activeDocumentId, editor } = this.#get();
    if (!editor) return null;

    try {
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const editorData = editor.getDocument('json');
      return { editorData, markdown: this.getPersistedMarkdown(activeDocumentId, markdown) };
    } catch (error) {
      console.error('[DocumentStore] Failed to get editor content:', error);
      return null;
    }
  };

  private syncEditorContent = (
    documentId?: string,
    options: { triggerAutoSave?: boolean } = {},
  ): boolean => {
    const { editor, activeDocumentId, documents, internal_dispatchDocument } = this.#get();
    const id = documentId || activeDocumentId;

    if (!editor || !id) return false;

    const doc = documents[id];
    if (!doc) return false;

    try {
      const editorMarkdown = (editor.getDocument('markdown') as unknown as string) || '';
      const markdown = this.getPersistedMarkdown(id, editorMarkdown);
      const editorData = editor.getDocument('json');

      const markdownChanged = markdown !== doc.lastSavedContent;
      const editorDataChanged = !isEqual(editorData, doc.lastSavedEditorData);
      const contentChanged = markdownChanged || editorDataChanged;

      internal_dispatchDocument(
        {
          id,
          type: 'updateDocument',
          value: { content: markdown, editorData, isDirty: contentChanged },
        },
        'handleContentChange',
      );

      // Only trigger auto-save if content actually changed AND autoSave is enabled
      if (options.triggerAutoSave !== false && contentChanged && doc.autoSave !== false) {
        this.#get().triggerDebouncedSave(id);
      }

      return contentChanged;
    } catch (error) {
      console.error('[DocumentStore] Failed to update content:', error);
      return false;
    }
  };

  commitEditorMutation = async (
    documentId?: string,
    options?: SaveExecutionOptions,
  ): Promise<void> => {
    const id = documentId || this.#get().activeDocumentId;
    if (!id) return;

    this.syncEditorContent(id, { triggerAutoSave: false });
    await this.performSave(id, undefined, options);
  };

  handleContentChange = (): void => {
    this.syncEditorContent(undefined, { triggerAutoSave: true });
  };

  updateSkillFrontmatter = (documentId: string, frontmatter: string): boolean => {
    const { activeDocumentId, documents, editor, internal_dispatchDocument } = this.#get();
    const doc = documents[documentId];

    if (!doc || doc.contentFormat !== 'skillMarkdown') return false;

    try {
      const isActiveDocument = activeDocumentId === documentId;
      const body =
        isActiveDocument && editor
          ? (editor.getDocument('markdown') as unknown as string) || ''
          : parseSkillMarkdownFrontmatter(doc.content).body;
      const editorData = isActiveDocument && editor ? editor.getDocument('json') : doc.editorData;
      const content = composeSkillMarkdown(frontmatter, body);
      const contentChanged = content !== doc.lastSavedContent;
      const editorDataChanged = !isEqual(editorData, doc.lastSavedEditorData);

      internal_dispatchDocument(
        {
          id: documentId,
          type: 'updateDocument',
          value: {
            content,
            editorData,
            isDirty: contentChanged || editorDataChanged,
            skillFrontmatter: frontmatter,
          },
        },
        'updateSkillFrontmatter',
      );

      return true;
    } catch (error) {
      console.error('[DocumentStore] Failed to update SKILL.md frontmatter:', error);
      return false;
    }
  };

  internal_dispatchDocument = (payload: DocumentDispatch, action?: string): void => {
    const { documents } = this.#get();
    const nextDocuments = documentReducer(documents, payload);

    if (isEqual(documents, nextDocuments)) return;

    this.#set(
      { documents: nextDocuments },
      false,
      action ?? n(`dispatchDocument/${payload.type}`, { id: payload.id }),
    );
  };

  markDirty = (documentId: string): void => {
    const { documents, internal_dispatchDocument } = this.#get();
    if (!documents[documentId]) return;

    internal_dispatchDocument({ id: documentId, type: 'updateDocument', value: { isDirty: true } });
  };

  reconcileRemote = (documentId: string, row: RemoteDocumentRow): ReconcileResult => {
    const { documents, internal_dispatchDocument } = this.#get();
    const doc = documents[documentId];
    if (!doc) return 'unchanged';

    const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
    if (doc.lastUpdatedTime && updatedAt.getTime() <= doc.lastUpdatedTime.getTime()) {
      return 'unchanged';
    }

    const content = row.content ?? '';
    const editorData = isValidEditorData(row.editorData) ? row.editorData : null;
    const sameBody =
      content === (doc.lastSavedContent ?? '') &&
      isEqual(editorData, doc.lastSavedEditorData ?? null);

    if (sameBody) {
      internal_dispatchDocument(
        { id: documentId, type: 'updateDocument', value: { lastUpdatedTime: updatedAt } },
        n('reconcileRemote/rebased'),
      );
      return 'rebased';
    }

    this.#get().cancelDebouncedSave(documentId);
    internal_dispatchDocument(
      {
        id: documentId,
        type: 'updateDocument',
        value: {
          content,
          editorData,
          isDirty: false,
          lastSavedContent: content,
          lastSavedEditorData: editorData,
          lastUpdatedTime: updatedAt,
          saveBlockedByLock: false,
          saveStatus: 'saved',
        },
      },
      n('reconcileRemote/adopted'),
    );
    return 'adopted';
  };

  onEditorInit = async (editor: IEditor): Promise<void> => {
    const { activeDocumentId, documents } = this.#get();
    if (!editor || !activeDocumentId) return;

    const doc = documents[activeDocumentId];

    if (!doc) return;

    // Check if editorData is valid and non-empty
    const hasValidEditorData =
      doc.editorData &&
      typeof doc.editorData === 'object' &&
      Object.keys(doc.editorData).length > 0;

    // SKILL.md frontmatter is metadata, not editable document body. Keep it out of the rich
    // Markdown editor because `---` fences are otherwise parsed as Markdown dividers/headings,
    // then stitch the same YAML back into the persisted content during save.
    if (doc.contentFormat === 'skillMarkdown') {
      if (hasValidEditorData) {
        try {
          editor.setDocument('json', JSON.stringify(doc.editorData));
          return;
        } catch {
          console.warn(
            '[DocumentStore] Failed to load SKILL.md editorData, falling back to markdown',
          );
        }
      }

      try {
        editor.setDocument('markdown', parseSkillMarkdownFrontmatter(doc.content).body);
        this.#set({ editor });
      } catch (err) {
        console.error('[DocumentStore] Failed to load SKILL.md content:', err);
      }

      return;
    }

    // Set content from document state
    if (hasValidEditorData) {
      try {
        editor.setDocument('json', JSON.stringify(doc.editorData));
        return;
      } catch {
        // Fallback to markdown if JSON fails
        console.warn('[DocumentStore] Failed to load editorData, falling back to markdown');
      }
    }

    try {
      if (doc.content?.trim()) {
        editor.setDocument('markdown', doc.content);
      } else {
        editor.setDocument('json', JSON.stringify(EMPTY_EDITOR_STATE));
      }
    } catch (err) {
      console.error('[DocumentStore] Failed to load markdown content:', err);
    }

    this.#set({ editor });
  };

  performSave = async (
    documentId?: string,
    metadata?: SaveMetadata,
    options?: SaveExecutionOptions,
  ): Promise<void> => {
    const id = documentId || this.#get().activeDocumentId;

    if (!id) return;

    const { editor, documents, internal_dispatchDocument } = this.#get();
    const doc = documents[id];
    if (!doc || !editor) return;

    const hasMetadataChanges = metadata?.emoji !== undefined || metadata?.title !== undefined;

    // Skip save if neither document content nor metadata changed
    if (!doc.isDirty && !hasMetadataChanges) return;

    if (doc.saveStatus === 'saving') {
      this.#get().triggerDebouncedSave(id);
      return;
    }

    // Update save status
    internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'saving' } });

    try {
      const currentEditorMarkdown = (editor.getDocument('markdown') as unknown as string) || '';
      const currentContent = this.getPersistedMarkdown(id, currentEditorMarkdown);
      const currentEditorData = editor.getDocument('json');

      if (!isValidEditorData(currentEditorData)) {
        console.warn('[DocumentStore] Refusing to save invalid editorData:', currentEditorData);
        internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'idle' } });
        return;
      }

      // Preserve diff nodes (pending review) through the save path.
      // Normalization only happens when the user explicitly clicks Accept/Reject
      // in DiffAllToolbar, which mutates editor state before calling performSave.
      const requestSave = (expectedUpdatedAt?: Date) =>
        documentService.updateDocument({
          content: currentContent,
          editorData: JSON.stringify(currentEditorData),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          id,
          lockOwnerId: doc.lockOwnerId,
          metadata: metadata?.emoji ? { emoji: metadata.emoji } : undefined,
          restoreFromHistoryId: options?.restoreFromHistoryId,
          saveSource: options?.saveSource,
          title: metadata?.title,
        });

      let result: Awaited<ReturnType<typeof requestSave>>;
      try {
        result = await requestSave(doc.lastUpdatedTime ?? undefined);
      } catch (error) {
        const canRetry = !hasMetadataChanges && !options?.restoreFromHistoryId;
        result = await this.retrySaveAfterReconcile(id, doc, error, requestSave, canRetry);
      }

      const savedAt = new Date(result.updatedAt);
      const current = this.#get().documents[id];
      if (current?.lastUpdatedTime && savedAt < current.lastUpdatedTime) {
        internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'saved' } });
        return;
      }

      internal_dispatchDocument({
        id,
        type: 'updateDocument',
        value: {
          content: currentContent,
          editorData: structuredClone(currentEditorData),
          isDirty: false,
          lastSavedContent: currentContent,
          lastSavedEditorData: structuredClone(currentEditorData),
          lastUpdatedTime: savedAt,
          saveBlockedByLock: false,
          saveStatus: 'saved',
        },
      });

      const latestMarkdown = (editor.getDocument('markdown') as unknown as string) || '';
      if (this.getPersistedMarkdown(id, latestMarkdown) !== currentContent) {
        internal_dispatchDocument({ id, type: 'updateDocument', value: { isDirty: true } });
        if (doc.autoSave !== false) this.#get().triggerDebouncedSave(id);
      }
    } catch (error) {
      const errorCode = (error as { data?: { code?: string } })?.data?.code;
      const conflicted = errorCode === 'CONFLICT';
      // A view-level workspace member has no edit right on this document
      // (FORBIDDEN). Tell the user instead of silently dropping the edit.
      if (errorCode === 'FORBIDDEN') {
        toast.error(t('permission.saveNoEditPermission', { ns: 'setting' }));
      }
      if (!conflicted) console.error('[DocumentStore] Failed to save:', error);
      const live = this.#get().documents[id];
      const lockBlocked = conflicted && !!live?.lockOwnerId;
      const adoptedRemote = conflicted && !lockBlocked && live?.isDirty === false;
      internal_dispatchDocument({
        id,
        type: 'updateDocument',
        value: {
          saveBlockedByLock: lockBlocked || undefined,
          saveStatus: adoptedRemote ? 'saved' : 'idle',
        },
      });
      if (conflicted && !lockBlocked && live?.isDirty && live.autoSave !== false) {
        this.#get().triggerDebouncedSave(id);
      }
    }
  };

  private retrySaveAfterReconcile = async <T>(
    id: string,
    baseDoc: {
      lastSavedContent?: string;
      lastSavedEditorData?: unknown;
      lockOwnerId?: string;
    },
    error: unknown,
    requestSave: (expectedUpdatedAt?: Date) => Promise<T>,
    canRetry: boolean,
  ): Promise<T> => {
    const errorCode = (error as { data?: { code?: string } })?.data?.code;
    if (errorCode !== 'CONFLICT') throw error;

    let latest: Awaited<ReturnType<typeof documentService.getDocumentById>>;
    try {
      latest = await documentService.getDocumentById(id);
    } catch {
      throw error;
    }
    if (!latest?.updatedAt) throw error;

    const outcome = this.reconcileRemote(id, latest);
    if (outcome === 'adopted') {
      void mutate(documentSWRKeys.editor(id), latest, { revalidate: false });
    }
    if (outcome === 'adopted' || !canRetry) throw error;

    // `baseDoc` is the store snapshot this request was built from; an
    // overlapping newer save from this tab may have moved the live base since,
    // in which case replaying this payload would roll that save back.
    const live = this.#get().documents[id];
    const sameBase =
      (live?.lastSavedContent ?? '') === (baseDoc.lastSavedContent ?? '') &&
      isEqual(live?.lastSavedEditorData ?? null, baseDoc.lastSavedEditorData ?? null);
    if (!sameBase) throw error;

    const { lockOwnerId } = baseDoc;
    if (lockOwnerId) {
      let lockedByOther: boolean;
      try {
        ({ lockedByOther } = await documentService.acquireDocumentLock(id, lockOwnerId));
      } catch {
        throw error;
      }
      if (lockedByOther) throw error;
    }

    try {
      return await requestSave(latest.updatedAt);
    } catch (retryError) {
      // The reclaim above transferred the lease to this session for a retry
      // that then failed. Keeping the stolen lease would make the lock
      // recovery read this tab as the legitimate holder and clear the save
      // block over a stale editor — release it so the lease goes back to
      // whoever is actually editing.
      if (lockOwnerId) void documentService.releaseDocumentLock(id, lockOwnerId).catch(() => {});
      throw retryError;
    }
  };

  setEditorState = (editorState: LobehubEditorState | undefined): void => {
    this.#set({ editorState }, false, n('setEditorState'));
  };

  /**
   * Clear the "save rejected by another member's lock" flag.
   *
   * `saveBlockedByLock` is set on a CONFLICT save and otherwise only cleared by a
   * *successful* save — but a blocked editor is read-only, so it can never reach
   * that success path on its own. Once the lock is no longer held by someone else
   * (we hold it, or it's free), the block is stale and must be dropped, or the
   * user stays stuck read-only behind a banner naming the current holder (which
   * may now be themselves). Called by the lock driver on that transition.
   */
  clearSaveBlockedByLock = (id: string): void => {
    const { documents, internal_dispatchDocument } = this.#get();
    if (!documents[id]?.saveBlockedByLock) return;
    internal_dispatchDocument({ id, type: 'updateDocument', value: { saveBlockedByLock: false } });
  };
}

export type EditorAction = Pick<EditorActionImpl, keyof EditorActionImpl>;
