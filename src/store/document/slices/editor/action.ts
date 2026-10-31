'use client';

import { DOCUMENT_CHAR_LIMIT_EXCEEDED, type DocumentCharLimitErrorData } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import type { EditorState as LobehubEditorState } from '@lobehub/editor/react';
import { toast } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';
import { isValidEditorData } from '@/libs/editor/isValidEditorData';
import { documentService } from '@/services/document';
import type { StoreSetter } from '@/store/types';
import { composeSkillMarkdown, parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';
import { setNamespace } from '@/utils/storeDebug';

import { PAGE_SYNC_WAIT_MS, waitForPageSynced } from '../../collabRegistry';
import type { DocumentStore } from '../../store';
import { documentDetailResource } from '../document/projection';
import type { DocumentFormatFields } from './contentFormat';
import { hasDocumentFormatFields, resolveDocumentContentFormat } from './contentFormat';
import type { EditorContentState } from './initialState';
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
  /** Persist title/emoji without reading, writing or acknowledging the editor body. */
  metadataOnly?: boolean;
  restoreFromHistoryId?: string;
  saveSource?: 'autosave' | 'manual' | 'restore' | 'system' | 'llm_call';
}

export interface RemoteDocumentRow extends DocumentFormatFields {
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
  readonly #inflightSaves = new Map<string, Promise<void>>();
  /** Document whose body each editor instance was last loaded with. */
  readonly #editorDocumentIds = new WeakMap<IEditor, string>();

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

    if (!editor || !id || id !== activeDocumentId) return false;
    // A document switch moves `activeDocumentId` before the editor in the store
    // holds the new body (each canvas mount creates its own editor, and the store
    // keeps the previous one until it updates). Reading it now would write the
    // previous document's body into this one.
    const loadedDocumentId = this.#editorDocumentIds.get(editor);
    if (loadedDocumentId !== undefined && loadedDocumentId !== id) return false;

    const doc = documents[id];
    if (!doc || doc.contentFormat === 'html') return false;

    try {
      const editorMarkdown = (editor.getDocument('markdown') as unknown as string) || '';
      const markdown = this.getPersistedMarkdown(id, editorMarkdown);
      const editorData = editor.getDocument('json');

      if (doc.collab) {
        internal_dispatchDocument(
          {
            id,
            type: 'updateDocument',
            value: {
              content: markdown,
              editorData,
              isDirty: false,
              lastSavedContent: markdown,
              lastSavedEditorData: editorData,
            },
          },
          'handleContentChange/collab',
        );
        return false;
      }

      const markdownChanged = markdown !== doc.lastSavedContent;
      const editorDataChanged = !isEqual(editorData, doc.lastSavedEditorData);
      const isLoadedBody =
        !!doc.loadedBody &&
        markdown === doc.loadedBody.content &&
        isEqual(editorData, doc.loadedBody.editorData);
      const contentChanged = !isLoadedBody && (markdownChanged || editorDataChanged);

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

  setDocumentCollab = (documentId: string, collab: boolean): void => {
    const { documents, internal_dispatchDocument } = this.#get();
    if (!documents[documentId] || documents[documentId].collab === collab) return;

    if (collab) this.#get().cancelDebouncedSave(documentId);
    internal_dispatchDocument(
      { id: documentId, type: 'updateDocument', value: { collab, isDirty: false } },
      n('setDocumentCollab'),
    );
  };

  /**
   * An agent command starts editing the stored page: save what the user typed
   * so the agent reads it, and hold the page read-only until the command ends.
   */
  beginAgentEdit = (documentId: string): void => {
    const doc = this.#get().documents[documentId];
    if (!doc) return;

    this.#get().internal_dispatchDocument(
      {
        id: documentId,
        type: 'updateDocument',
        value: { agentEditing: (doc.agentEditing ?? 0) + 1 },
      },
      n('beginAgentEdit'),
    );
    if (doc.isDirty) void this.#get().performSave(documentId);
  };

  /** One agent command ended; `all` releases the page when the whole run is over. */
  endAgentEdit = (documentId: string, options?: { all?: boolean }): void => {
    const doc = this.#get().documents[documentId];
    if (!doc?.agentEditing) return;

    this.#get().internal_dispatchDocument(
      {
        id: documentId,
        type: 'updateDocument',
        value: { agentEditing: options?.all ? 0 : doc.agentEditing - 1 },
      },
      n('endAgentEdit'),
    );
  };

  /**
   * Saves the page as a version the user asked for (the save hotkey, accepting
   * AI suggestions). A room page persists through its room, which
   * `performSave` skips, so the server records the room's state once this
   * client's pending updates reached it.
   */
  saveVersion = async (documentId: string): Promise<void> => {
    if (!this.#get().documents[documentId]?.collab) {
      return this.#get().performSave(documentId, undefined, { saveSource: 'manual' });
    }

    await waitForPageSynced(documentId, PAGE_SYNC_WAIT_MS);
    await documentService.snapshotPageVersion(documentId, 'manual');
  };

  /**
   * Restores a history version into the page. A room page restores on the
   * server, which merges it into the room for everyone; applying it here as
   * well would insert it into the room a second time.
   */
  restoreVersion = async (
    documentId: string,
    version: { editorData: unknown; historyId: string },
  ): Promise<void> => {
    const { documents, editor, markDirty, performSave } = this.#get();

    if (documents[documentId]?.collab) {
      await documentService.updateDocument({
        editorData: JSON.stringify(version.editorData),
        id: documentId,
        restoreFromHistoryId: version.historyId,
        saveSource: 'restore',
      });
      return;
    }

    editor?.setDocument('json', JSON.stringify(version.editorData));
    markDirty(documentId);
    await performSave(documentId, undefined, {
      restoreFromHistoryId: version.historyId,
      saveSource: 'restore',
    });
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

    // The live room owns the body; a projected row can lag behind it.
    if (doc.collab) {
      internal_dispatchDocument(
        { id: documentId, type: 'updateDocument', value: { lastUpdatedTime: updatedAt } },
        n('reconcileRemote/collab'),
      );
      return 'rebased';
    }

    const content = row.content ?? '';
    const editorData = isValidEditorData(row.editorData) ? row.editorData : null;
    const sameBody =
      content === (doc.lastSavedContent ?? '') &&
      isEqual(editorData, doc.lastSavedEditorData ?? null);
    // A remote write can change the type alone (`lh doc edit --file-type`): the
    // HTML guards and the SKILL.md frontmatter split must follow the new type.
    const contentFormat = hasDocumentFormatFields(row)
      ? resolveDocumentContentFormat(row)
      : doc.contentFormat;
    const formatChanged = contentFormat !== doc.contentFormat;
    const skillFrontmatter =
      contentFormat === 'skillMarkdown'
        ? parseSkillMarkdownFrontmatter(content).frontmatter
        : undefined;

    if (sameBody) {
      internal_dispatchDocument(
        {
          id: documentId,
          type: 'updateDocument',
          value: {
            lastUpdatedTime: updatedAt,
            ...(formatChanged ? { contentFormat, skillFrontmatter } : {}),
          },
        },
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
          contentFormat,
          editorData,
          ...(contentFormat === 'skillMarkdown' || formatChanged ? { skillFrontmatter } : {}),
          isDirty: false,
          lastSavedContent: content,
          lastSavedEditorData: editorData,
          lastUpdatedTime: updatedAt,
          // The editor reloads the adopted body and records it again.
          loadedBody: undefined,
          charLimitError: undefined,
          saveBlockedByLock: false,
          saveStatus: 'saved',
        },
      },
      n('reconcileRemote/adopted'),
    );
    return 'adopted';
  };

  /**
   * Hydrate the document owned by this canvas. A child's initialization effect can
   * run before the parent's activeDocumentId update, so the global selection is
   * not a reliable identity for the body being mounted.
   */
  onEditorInit = async (editor: IEditor, documentId: string): Promise<void> => {
    const { documents } = this.#get();
    if (!editor) return;

    const doc = documents[documentId];

    if (!doc || doc.contentFormat === 'html') return;

    this.#loadDocumentIntoEditor(editor, doc);
    this.#editorDocumentIds.set(editor, documentId);
    if (!doc.isDirty) this.#adoptLoadedBody(editor, documentId);
  };

  /**
   * Record the body the editor just loaded as unedited. Loading is not
   * byte-stable: markdown is parsed into a fresh tree with new node ids, and the
   * editor's own markdown need not match the stored text. A page an agent or
   * the CLI wrote has no editorData at all, so without this the load itself
   * reads as an edit — opening the page marks it dirty, autosaves it and holds
   * navigation behind a "Saving…" toast although the user changed nothing.
   *
   * `lastSaved*` keeps the server's body: conflict reconciliation compares
   * remote rows against it, and a normalized copy there would make a remote
   * title-only change look like a body change and discard local edits.
   */
  #adoptLoadedBody = (editor: IEditor, documentId: string): void => {
    try {
      const markdown = this.getPersistedMarkdown(
        documentId,
        (editor.getDocument('markdown') as unknown as string) || '',
      );
      const editorData = editor.getDocument('json');
      if (!isValidEditorData(editorData)) return;

      // The load's own change event already queued an autosave of this body.
      this.#get().cancelDebouncedSave(documentId);
      this.#get().internal_dispatchDocument(
        {
          id: documentId,
          type: 'updateDocument',
          value: {
            content: markdown,
            editorData,
            isDirty: false,
            loadedBody: { content: markdown, editorData },
          },
        },
        'adoptLoadedBody',
      );
    } catch (error) {
      console.error('[DocumentStore] Failed to read the loaded body:', error);
    }
  };

  #loadDocumentIntoEditor = (editor: IEditor, doc: EditorContentState): void => {
    // Check if editorData is valid and non-empty
    const editorDataRoot = (doc.editorData as { root?: { children?: unknown[] } } | null)?.root;
    // A childless root (empty-parse shell) throws Lexical error #38 on hydration;
    // treat it as no editor data so the markdown/empty fallbacks below take over.
    // Only the targeted Lexical shell shape (root node present with an empty
    // children array) is rejected — legacy non-Lexical payloads without a root
    // node (e.g. { type: 'doc', content: [] }) keep loading via setDocument('json').
    const isEmptyParseShell =
      !!editorDataRoot &&
      Array.isArray(editorDataRoot.children) &&
      editorDataRoot.children.length === 0;
    const hasValidEditorData =
      doc.editorData &&
      typeof doc.editorData === 'object' &&
      Object.keys(doc.editorData).length > 0 &&
      !isEmptyParseShell;

    // SKILL.md frontmatter is metadata, not editable document body. Keep it out of the rich
    // Markdown editor because `---` fences are otherwise parsed as Markdown dividers/headings,
    // then stitch the same YAML back into the persisted content during save.
    if (doc.contentFormat === 'skillMarkdown') {
      if (hasValidEditorData) {
        try {
          editor.setDocument('json', JSON.stringify(doc.editorData), { keepId: true });
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
        editor.setDocument('json', JSON.stringify(doc.editorData), { keepId: true });
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

  getPendingSave = (documentId: string): Promise<void> | undefined =>
    this.#inflightSaves.get(documentId);

  performSave = async (
    documentId?: string,
    metadata?: SaveMetadata,
    options?: SaveExecutionOptions,
  ): Promise<void> => {
    const id = documentId || this.#get().activeDocumentId;
    if (!id) return;

    if (!options?.metadataOnly) this.syncEditorContent(id, { triggerAutoSave: false });
    const previous = this.#inflightSaves.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.#runSave(id, metadata, options));
    this.#inflightSaves.set(id, run);
    try {
      await run;
    } finally {
      if (this.#inflightSaves.get(id) === run) this.#inflightSaves.delete(id);
    }
  };

  #runSave = async (
    id: string,
    metadata?: SaveMetadata,
    options?: SaveExecutionOptions,
  ): Promise<void> => {
    // Capture the identity before the request: the detail replica must not be
    // refreshed under a new account / workspace if one switches mid-save.
    const scope = documentDetailResource.scope.get();
    const { documents, internal_dispatchDocument } = this.#get();
    const doc = documents[id];
    if (!doc) return;

    const hasEmojiChange = metadata !== undefined && 'emoji' in metadata;
    const hasMetadataChanges = hasEmojiChange || metadata?.title !== undefined;
    const savedMetadata = hasEmojiChange
      ? Object.fromEntries(
          Object.entries({
            ...this.#get().documentDetailMap[id]?.document?.metadata,
            emoji: metadata?.emoji,
          }).filter(([, value]) => value !== undefined),
        )
      : undefined;
    // An HTML page's body is never edited here, and a room page's body persists
    // through its room: only their title / emoji save.
    const metadataOnly =
      options?.metadataOnly === true || doc.contentFormat === 'html' || !!doc.collab;
    if (metadataOnly && !hasMetadataChanges) return;

    // Skip save if neither document content nor metadata changed
    if (!doc.isDirty && !hasMetadataChanges) return;

    // Update save status
    internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'saving' } });

    try {
      const currentContent = doc.content ?? '';
      const currentEditorData = doc.editorData;

      if (!metadataOnly && !isValidEditorData(currentEditorData)) {
        console.warn('[DocumentStore] Refusing to save invalid editorData:', currentEditorData);
        internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'idle' } });
        return;
      }

      // Preserve diff nodes (pending review) through the save path.
      // Normalization only happens when the user explicitly clicks Accept/Reject
      // in DiffAllToolbar, which mutates editor state before calling performSave.
      const requestSave = (expectedUpdatedAt?: Date) =>
        documentService.updateDocument({
          ...(!metadataOnly
            ? { content: currentContent, editorData: JSON.stringify(currentEditorData) }
            : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          id,
          lockOwnerId: doc.lockOwnerId,
          metadata: savedMetadata,
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

      // Old servers omit updatedAt. Keep the known token; conflict reconciliation
      // refreshes it on the next save without trusting the history-only savedAt.
      const savedAt = result.updatedAt ? new Date(result.updatedAt) : undefined;
      const current = this.#get().documents[id];
      if (savedAt && current?.lastUpdatedTime && savedAt < current.lastUpdatedTime) {
        internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'saved' } });
        return;
      }

      internal_dispatchDocument({
        id,
        type: 'updateDocument',
        value: {
          // A metadata response cannot acknowledge body edits that it never sent.
          ...(!metadataOnly
            ? {
                isDirty:
                  current?.content !== currentContent ||
                  !isEqual(current?.editorData, currentEditorData),
                lastSavedContent: currentContent,
                lastSavedEditorData: structuredClone(currentEditorData),
                // The saved body is now the editor's own serialization.
                loadedBody: undefined,
                // Only a saved body clears a body refused for its length.
                charLimitError: undefined,
              }
            : {}),
          ...(savedAt ? { lastUpdatedTime: savedAt } : {}),
          saveBlockedByLock: false,
          // A title save does not save a body still refused for its length.
          saveStatus: metadataOnly && current?.charLimitError ? 'failed' : 'saved',
        },
      });

      // The server now holds this body. Mirror it into the detail replica: its
      // IndexedDB row is what a reload paints before the network answers, so
      // leaving the pre-edit body there would render stale content — and keep
      // rendering it when the confirming read is slow or fails.
      const cachedDetail = this.#get().documentDetailMap[id]?.document;
      // A read that landed while this save was in flight may already hold a
      // newer writer's revision; mirroring this save over it would regress it.
      const cachedIsNewer =
        !!savedAt &&
        !!cachedDetail?.updatedAt &&
        new Date(cachedDetail.updatedAt).getTime() > savedAt.getTime();
      if (cachedDetail && !cachedIsNewer) {
        this.#get().internal_adoptDocumentDetail(
          id,
          {
            ...cachedDetail,
            ...(!metadataOnly ? { content: currentContent, editorData: currentEditorData } : {}),
            // Mirror the metadata this save wrote, exactly as the server applies
            // it (`title` also renames `filename`; `metadata` is replaced). A
            // stale title / emoji here would be republished by the next body
            // save and painted by a reload whose confirming read fails.
            ...(metadata?.title !== undefined
              ? { filename: metadata.title, title: metadata.title }
              : {}),
            ...(savedMetadata ? { metadata: savedMetadata } : {}),
            updatedAt: savedAt ?? cachedDetail.updatedAt,
          },
          scope,
        );
      }

      if (!metadataOnly && this.#get().documents[id]?.isDirty && doc.autoSave !== false) {
        this.#get().triggerDebouncedSave(id);
      }
    } catch (error) {
      // The plan's per-document character limit refused this body. Keep it dirty
      // and surface a persistent banner instead of a toast on every autosave; no
      // debounced retry, since the same body would be refused again until the
      // user shortens it (the next edit schedules the next attempt).
      const charLimitData = (
        error as { data?: { errorData?: Partial<DocumentCharLimitErrorData> } }
      )?.data?.errorData;
      if (
        charLimitData?.code === DOCUMENT_CHAR_LIMIT_EXCEEDED &&
        typeof charLimitData.limit === 'number'
      ) {
        internal_dispatchDocument({
          id,
          type: 'updateDocument',
          value: {
            charLimitError: {
              actual: charLimitData.actual ?? (doc.content ?? '').length,
              limit: charLimitData.limit,
              plan: charLimitData.plan,
            },
            saveStatus: 'failed',
          },
        });
        if (hasMetadataChanges) throw error;
        return;
      }

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
      if (hasMetadataChanges) throw error;
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

    // Capture the identity BEFORE the request, like the sync and prefetch paths.
    // An account / workspace switch while the read is in flight must not
    // reconcile the previous identity's row into the new identity's editor
    // state, nor persist it into the new scope's replica partition.
    const scope = documentDetailResource.scope.get();

    let latest: Awaited<ReturnType<typeof documentService.getDocumentById>>;
    try {
      latest = await documentService.getDocumentById(id);
    } catch {
      throw error;
    }
    if (!latest?.updatedAt) throw error;
    // The identity moved on while we were fetching: this reconciliation is stale.
    if (scope !== documentDetailResource.scope.get()) throw error;

    const outcome = this.reconcileRemote(id, latest);
    if (outcome === 'adopted') {
      // Feed the adopted row back into the detail replica so the next sync
      // reconciles against it instead of re-adopting a stale server read.
      this.#get().internal_adoptDocumentDetail(id, latest, scope);
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
