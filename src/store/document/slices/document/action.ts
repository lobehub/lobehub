'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';
import type { IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import { useLayoutEffect } from 'react';

import { createReplicaSlice, recordLens } from '@/libs/replica';
import { documentService } from '@/services/document';
import { pageActions } from '@/store/page';
import type { StoreSetter } from '@/store/types';
import { isSkillMarkdownDocument, parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';
import { useDocumentStore } from '../../store';
import type { DocumentContentFormat, DocumentSourceType } from '../editor/initialState';
import type { DocumentDetail } from './projection';
import { documentDetailResource } from './projection';

const n = setNamespace('document/document');

/**
 * Parameters for initializing a document with editor
 */
export interface InitDocumentParams {
  /**
   * Whether auto-save is enabled. Defaults to true.
   * Set to false if the consumer handles saving themselves.
   */
  autoSave?: boolean;
  content?: string | null;
  contentFormat?: DocumentContentFormat;
  documentId: string;
  editor: IEditor;
  editorData?: unknown;
  sourceType: DocumentSourceType;
  topicId?: string;
  updatedAt?: Date | string | null;
}

/**
 * Options for useFetchDocument hook
 */
export interface UseFetchDocumentOptions {
  /**
   * Whether auto-save is enabled. Defaults to true.
   */
  autoSave?: boolean;
  /**
   * Editor instance to load content into
   */
  editor?: IEditor;
  /**
   * Source type for the document. Defaults to 'page'.
   */
  sourceType?: DocumentSourceType;
  /**
   * Topic ID for notebook documents.
   */
  topicId?: string | null;
}

/**
 * Result of `useFetchDocument`.
 *
 * `data` is the replica view (`undefined` = nothing loaded for this id yet,
 * `null` = the server answered "not found"). It is read from the store, not
 * returned by the hook, so it paints from the persisted projection on the first
 * frame and the network only confirms it.
 */
export interface UseFetchDocumentResult {
  data: DocumentItem | null | undefined;
  error: unknown;
  /** SWR's `isLoading` semantics: no value yet and no error. */
  isLoading: boolean;
  isValidating: boolean;
  /** Re-run the network sync for this document. */
  mutate: () => Promise<unknown>;
}

type Setter = StoreSetter<DocumentStore>;
export const createDocumentSlice = (set: Setter, get: () => DocumentStore, _api?: unknown) =>
  new DocumentActionImpl(set, get, _api);

export class DocumentActionImpl {
  readonly #get: () => DocumentStore;
  readonly #set: Setter;
  readonly #debouncedSaves = new Map<string, ReturnType<typeof debounce>>();
  readonly #detail;

  constructor(set: Setter, get: () => DocumentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#detail = createReplicaSlice(documentDetailResource, {
      actionPrefix: n('documentDetail'),
      fetcher: async (id) => ({ document: (await documentService.getDocumentById(id)) ?? null }),
      get,
      set,
      stateKey: 'documentDetailReplica',
      // A "not found" answer is a page state, not a document: never persist it,
      // and evict the row persisted for this document earlier (the engine
      // removes it) so a reload cannot resurrect a deleted / revoked document.
      toPersisted: (data) => (data.document ? data : null),
      view: recordLens<DocumentStore, DocumentDetail>('documentDetailMap'),
    });
  }

  cancelDebouncedSave = (documentId: string): void => {
    this.#debouncedSaves.get(documentId)?.cancel();
  };

  #getOrCreateDebouncedSave = (documentId: string) => {
    if (!this.#debouncedSaves.has(documentId)) {
      const debouncedFn = debounce(
        async () => {
          try {
            await this.#get().performSave(documentId, undefined, { saveSource: 'autosave' });
          } catch (error) {
            console.error('[DocumentStore] Failed to auto-save:', error);
          }
        },
        EDITOR_DEBOUNCE_TIME,
        { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
      );
      this.#debouncedSaves.set(documentId, debouncedFn);
    }
    return this.#debouncedSaves.get(documentId)!;
  };

  #cleanupDebouncedSave = (documentId: string) => {
    const fn = this.#debouncedSaves.get(documentId);
    if (fn) {
      fn.cancel();
      this.#debouncedSaves.delete(documentId);
    }
  };

  /**
   * Close a document and remove it from state
   */
  closeDocument = (documentId: string): void => {
    // Flush any pending saves before closing
    const save = this.#debouncedSaves.get(documentId);
    if (save) {
      save.flush();
      this.#cleanupDebouncedSave(documentId);
    }

    const { activeDocumentId, internal_dispatchDocument, getPendingSave } = this.#get();

    // Update activeDocumentId if needed
    if (activeDocumentId === documentId) {
      this.#set({ activeDocumentId: undefined }, false, n('closeDocument:clearActive'));
    }

    const remove = () => internal_dispatchDocument({ id: documentId, type: 'deleteDocument' });
    const pending = getPendingSave(documentId);
    if (pending) void pending.then(remove, remove);
    else remove();
  };

  /**
   * Flush any pending debounced save for a document
   */
  flushSave = (documentId?: string): void => {
    const id = documentId || this.#get().activeDocumentId;
    if (id) {
      const save = this.#debouncedSaves.get(id);
      save?.flush();
    }
  };

  /**
   * Initialize a document with editor - stores state only.
   * Content is loaded into editor via onEditorInit when Editor component is ready.
   */
  initDocumentWithEditor = (params: InitDocumentParams): void => {
    const {
      autoSave,
      content,
      contentFormat,
      documentId,
      editor,
      editorData,
      sourceType,
      topicId,
      updatedAt,
    } = params;

    const { internal_dispatchDocument } = this.#get();
    const skillFrontmatter =
      contentFormat === 'skillMarkdown'
        ? parseSkillMarkdownFrontmatter(content).frontmatter
        : undefined;

    // Add or update document via reducer
    internal_dispatchDocument({
      id: documentId,
      type: 'addDocument',
      value: {
        autoSave,
        content: content ?? undefined,
        contentFormat,
        editorData,

        lastSavedContent: content ?? undefined,
        lastSavedEditorData: editorData,
        sourceType,
        skillFrontmatter,
        topicId,
        ...(updatedAt
          ? {
              lastUpdatedTime: updatedAt instanceof Date ? updatedAt : new Date(updatedAt),
            }
          : {}),
      },
    });

    // Update activeDocumentId and editor
    this.#set(
      { activeDocumentId: documentId, editor },
      false,
      n('initDocumentWithEditor:setActive'),
    );
    if (sourceType === 'notebook' && topicId) this.#rememberTopicDocument(topicId, documentId);
  };

  #rememberTopicDocument = (topicId: string, documentId: string) => {
    this.#set(
      {
        lastActiveTopicDocumentIdByTopicId: {
          ...this.#get().lastActiveTopicDocumentIdByTopicId,
          [topicId]: documentId,
        },
      },
      false,
      n('rememberTopicDocument'),
    );
  };

  /**
   * Trigger a debounced save for the specified document
   */
  triggerDebouncedSave = (documentId: string): void => {
    const save = this.#getOrCreateDebouncedSave(documentId);
    save();
  };

  /**
   * Clear the editor state derived from a replica entry that has left the view.
   *
   * The only way a loaded entry disappears while this route stays mounted is a
   * replica scope reset (account / workspace switch), which drops every entry
   * of the previous identity. The editor state derived from that entry has to
   * go with it: `DocumentIdMode` treats a present `documents[id]` as "loaded",
   * so leaving it behind renders the previous identity's body — and, once the
   * new scope's request fails, keeps rendering it behind an inline error.
   *
   * A queued autosave is cancelled rather than flushed: it belongs to the
   * previous identity and must not be sent under the new one.
   */
  #clearDerivedDocument = (documentId: string): void => {
    if (!this.#get().documents[documentId]) return;
    this.cancelDebouncedSave(documentId);
    this.#get().internal_dispatchDocument(
      { id: documentId, type: 'deleteDocument' },
      n('clearDerivedDocument'),
    );
  };

  /**
   * Fold one server row into the editor's derived state.
   *
   * Called both when the replica view changes (the persisted projection paints
   * before the network answers) and when a fresh response lands, so the editor
   * adopts a document in either path. Idempotent: an existing entry is only
   * reconciled against, never re-initialized.
   */
  #adoptDocument = (
    documentId: string,
    document: DocumentItem | null,
    options: {
      autoSave?: boolean;
      editor?: IEditor;
      sourceType: DocumentSourceType;
      topicId?: string | null;
    },
  ): void => {
    const { autoSave, editor, sourceType, topicId } = options;
    // `null` = the server answered "not found"; nothing to adopt.
    if (!document || !editor) return;

    // Check if this response is still for the current active document.
    // This prevents race conditions when quickly switching between documents.
    const currentActiveId = this.#get().activeDocumentId;
    if (currentActiveId && currentActiveId !== documentId) return;

    if (this.#get().documents[documentId]) {
      this.#get().reconcileRemote(documentId, document);
      if (sourceType === 'notebook' && topicId) {
        this.#rememberTopicDocument(topicId, documentId);
      }
      if (sourceType === 'page') {
        pageActions.upsertDocument(document);
      }
      return;
    }

    this.#get().initDocumentWithEditor({
      autoSave,
      content: document.content,
      contentFormat: isSkillMarkdownDocument(document) ? 'skillMarkdown' : 'markdown',
      documentId,
      editor,
      editorData: document.editorData,
      sourceType,
      topicId: topicId ?? undefined,
      updatedAt: document.updatedAt,
    });

    // Mirror page metadata (title/emoji) into pageStore so PageExplorer
    // selectors resolve correctly when the page is opened from a context
    // that didn't pre-load the documents list (e.g. task workspace modal).
    if (sourceType === 'page') {
      pageActions.upsertDocument(document);
    }
  };

  /**
   * Fetch a document through its replica and initialize it in the DocumentStore.
   */
  useFetchDocument = (
    documentId: string | undefined,
    options: UseFetchDocumentOptions = {},
  ): UseFetchDocumentResult => {
    const { autoSave = true, editor, sourceType = 'page', topicId } = options;
    const enabled = Boolean(documentId && editor);

    // The view is the source of truth: read it from the store so a reload paints
    // the persisted projection on the first frame, before the network answers.
    const entry = useDocumentStore((s) =>
      documentId ? s.documentDetailMap[documentId] : undefined,
    );
    const document = entry?.document;

    const sync = this.#detail.useSync(enabled ? documentId : undefined, {
      // Keep a long-open editor in step with other writers. Personal and
      // notebook documents have no workspace-page SSE stream, so the app-wide
      // five-minute focus throttle would leave another writer's edit stale for
      // minutes after returning to the tab — ~20s is the window this was tuned
      // to before the migration.
      focusThrottleInterval: 20_000,
      revalidateOnFocus: true,
    });

    useLayoutEffect(() => {
      if (!enabled || !documentId) return;

      // Adopt *synchronously with the store write that produced the entry*, so
      // the editor state lands in the same commit as the hydrated view. Waiting
      // for a passive effect — or for `isHydrated`, which only flips in a later
      // commit — leaves a painted frame where the projection already holds the
      // document but `documents[id]` is still missing, and that frame is exactly
      // the skeleton flash a repeat visit is supposed to avoid.
      const adopt = (state: DocumentStore, previous?: DocumentStore) => {
        const next = state.documentDetailMap[documentId];
        if (!next) {
          // The entry left the view: a scope reset dropped the previous
          // identity's entries. Its derived editor state must not outlive it —
          // see `#clearDerivedDocument`.
          if (previous?.documentDetailMap[documentId]) this.#clearDerivedDocument(documentId);
          return;
        }
        // Only react to *this* entry changing; every other store write (typing
        // in the editor included) is none of our business.
        if (previous && previous.documentDetailMap[documentId] === next) return;
        // Entries are scope-owned by the engine; never adopt one that belongs to
        // another identity (this hook can stay mounted across an identity switch).
        const scope = state.documentDetailReplica?.scope;
        if (scope !== undefined && scope !== documentDetailResource.scope.get()) return;
        this.#adoptDocument(documentId, next.document, { autoSave, editor, sourceType, topicId });
      };

      // An entry already in memory (repeat visit in this session) never writes
      // again, so adopt it now; hydration and every response go through the
      // subscription.
      adopt(useDocumentStore.getState());
      return useDocumentStore.subscribe(adopt);
    }, [autoSave, documentId, editor, enabled, sourceType, topicId]);

    return {
      data: document,
      error: sync.error,
      isLoading: enabled && document === undefined && sync.error == null,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    };
  };

  /**
   * Warm the replica for a document the user is about to open (hover prefetch),
   * so navigation paints the editor from the projection instead of a skeleton.
   */
  prefetchDocument = async (documentId: string): Promise<void> => {
    // Capture the identity BEFORE the request. An account / workspace switch
    // while it is in flight would otherwise make `replace` fall back to the new
    // scope and write the old identity's document into its memory and IndexedDB
    // partition. The regular `useSync` path captures the scope the same way; the
    // engine drops an action whose scope is no longer active.
    const scope = documentDetailResource.scope.get();
    try {
      const document = await documentService.getDocumentById(documentId);
      // A sync that started while this was in flight owns the entry now: it may
      // hold a newer revision, or a confirmed absence. Never let a late
      // prefetch regress it — e.g. resurrect the body of a document the sync has
      // just settled as not-found. The entry is warmed on hover, so skipping
      // when one already exists only drops a redundant write.
      if (this.#get().documentDetailMap[documentId] !== undefined) return;
      this.#detail.replace(documentId, { document: document ?? null }, scope);
    } catch (error) {
      console.error('[DocumentStore] Failed to prefetch document:', error);
    }
  };

  /**
   * Adopt a server row the caller already holds (e.g. the save pipeline
   * reconciling a CONFLICT) so the replica — not a stale fetch — is what the
   * editor hydrates from next.
   *
   * `scope` is the identity the row was fetched under, captured *before* the
   * request. Pass it whenever the caller awaited something in between: an
   * account / workspace switch would otherwise make `replace` fall back to the
   * new scope and write the previous identity's document into its memory and
   * IndexedDB partition. The engine drops an action whose scope is no longer
   * active.
   */
  internal_adoptDocumentDetail = (
    documentId: string,
    document: DocumentItem | null,
    scope?: string,
  ): void => {
    this.#detail.replace(documentId, { document }, scope);
  };
}

export type DocumentAction = Pick<DocumentActionImpl, keyof DocumentActionImpl>;
