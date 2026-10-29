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
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';
import { setNamespace } from '@/utils/storeDebug';
import { isTrpcErrorCode } from '@/utils/trpcError';

import type { DocumentStore } from '../../store';
import { useDocumentStore } from '../../store';
import { resolveDocumentContentFormat } from '../editor/contentFormat';
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

/** Result of `useFetchDocumentDetail`; `data` is read from the replica view. */
export interface UseFetchDocumentDetailResult extends UseFetchDocumentResult {
  /** The persisted row has been read (or there was none to read). */
  isHydrated: boolean;
}

const detailLens = recordLens<DocumentStore, DocumentDetail>('documentDetailMap');

type Setter = StoreSetter<DocumentStore>;
export const createDocumentSlice = (set: Setter, get: () => DocumentStore, _api?: unknown) =>
  new DocumentActionImpl(set, get, _api);

export class DocumentActionImpl {
  readonly #get: () => DocumentStore;
  readonly #set: Setter;
  readonly #debouncedSaves = new Map<string, ReturnType<typeof debounce>>();
  /**
   * Per-document count of server rows adopted outside a read (saves, CONFLICT
   * reconciles). A read that saw the count change while in flight started
   * before that row was written, so it must not replace it.
   */
  readonly #adoptions = new Map<string, number>();
  readonly #detail;

  constructor(set: Setter, get: () => DocumentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#detail = createReplicaSlice(documentDetailResource, {
      actionPrefix: n('documentDetail'),
      fetcher: async (id) => {
        const adoptedBefore = this.#adoptions.get(id) ?? 0;
        const document = (await documentService.getDocumentById(id)) ?? null;
        // A save (or CONFLICT reconcile) adopted a server row while this read was
        // in flight: that row is newer than anything this read saw, even when an
        // older server returned no `updatedAt` to compare. Keep it.
        const current = this.#get().documentDetailMap[id];
        if ((this.#adoptions.get(id) ?? 0) !== adoptedBefore && current) return current;
        return this.#keepNewerDetail(id, { document });
      },
      effects: {
        // The server now denies this document (access revoked, session ended):
        // the cached copy must stop rendering — on screen and after a reload.
        // Transient failures keep it (stale-while-revalidate).
        onError: (error, _id, { key, scope }) => {
          if (!key) return;
          if (isTrpcErrorCode(error, 'FORBIDDEN') || isTrpcErrorCode(error, 'UNAUTHORIZED'))
            this.#detail.remove(key, scope);
        },
      },
      get,
      set,
      stateKey: 'documentDetailReplica',
      // A "not found" answer is a page state, not a document: never persist it,
      // and evict the row persisted for this document earlier (the engine
      // removes it) so a reload cannot resurrect a deleted / revoked document.
      toPersisted: (data) => (data.document ? data : null),
      view: { ...detailLens, clear: this.#clearDetailView },
    });
  }

  /**
   * Advance the adoption generation of `documentId` for a write confirmed under
   * `scope`. A write that settles after an account / workspace switch is dropped
   * by the replica, so it must not advance the guard either: a read of the same
   * id already in flight under the new identity would otherwise discard its
   * fresh response for the hydrated row.
   */
  #countAdoption = (documentId: string, scope: string): void => {
    if (scope !== documentDetailResource.scope.get()) return;
    this.#adoptions.set(documentId, (this.#adoptions.get(documentId) ?? 0) + 1);
  };

  /**
   * Scope reset (account / workspace switch): drop the projection together with
   * every editor entry derived from it, in the same commit.
   *
   * `useFetchDocument` only watches the document it is mounted for, so editor
   * entries of documents opened earlier in the session would otherwise survive
   * the reset: revisiting one under the new identity would treat the previous
   * identity's body as loaded (and keep showing it if the new fetch fails).
   * Their queued autosaves belong to the previous identity and are cancelled,
   * never flushed under the new one.
   */
  #clearDetailView = (state: DocumentStore): Partial<DocumentStore> => {
    // Every editor row, not only those whose detail entry is still in the map:
    // a bounded replica evicts unmounted entries (`persist.maxEntries`) and the
    // highlight editor creates its row directly (`addDocument`), yet each row
    // still holds the previous identity's body.
    const editorIds = Object.keys(state.documents);
    if (editorIds.length === 0) return detailLens.clear(state);

    const documents = { ...state.documents };
    for (const id of editorIds) {
      this.#cleanupDebouncedSave(id);
      delete documents[id];
    }
    return { ...detailLens.clear(state), documents };
  };

  /**
   * Order a fetched detail against the entry it is about to replace.
   *
   * A focus / SSE revalidation that started before a save but answers after it
   * carries the pre-save row. The save already adopted the newer revision into
   * the replica, so landing the late response would regress the projection and
   * its IndexedDB row — and a later offline reload would hydrate the pre-save
   * body. Keep the entry when the response is strictly older; a not-found answer
   * and any equal-or-newer revision still win.
   */
  #keepNewerDetail = (documentId: string, fetched: DocumentDetail): DocumentDetail => {
    const current = this.#get().documentDetailMap[documentId]?.document;
    const next = fetched.document;
    if (!current?.updatedAt || !next?.updatedAt) return fetched;
    return new Date(next.updatedAt).getTime() < new Date(current.updatedAt).getTime()
      ? { document: current }
      : fetched;
  };

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
      this.#reconcileWhenSettled(documentId, document);
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
      contentFormat: resolveDocumentContentFormat(document),
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
   * Reconcile a read once no save of this document is in flight.
   *
   * A read that lands mid-save (e.g. a focus revalidation after a tab switch)
   * may carry the row that save is writing, without the edits typed since:
   * adopting it then would wipe them from the editor. It may also carry a newer
   * writer's revision, so it is deferred rather than dropped: once the save
   * settles, the newest row in the view is reconciled, and `reconcileRemote`
   * ignores it unless it is newer than what the save confirmed.
   */
  #reconcileWhenSettled = (documentId: string, row: DocumentItem): void => {
    const pending = this.#get().getPendingSave(documentId);
    if (!pending) {
      this.#get().reconcileRemote(documentId, row);
      return;
    }

    const retry = () => {
      const latest = this.#get().documentDetailMap[documentId]?.document;
      if (latest) this.#reconcileWhenSettled(documentId, latest);
    };
    void pending.then(retry, retry);
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
   * Read one document's server row without mounting an editor — the portal
   * header / body switch, the agent-document breadcrumb, goal deliverables and
   * the resource preview. It shares the editor's replica entry, so every view of
   * a document paints from the same persisted projection on a reload and one
   * network sync confirms them all.
   *
   * `isLoading` keeps SWR's meaning (no value and no error yet). Check
   * `isHydrated` before showing a loading state: until the persisted row has
   * been read, "no value" may only mean "not read yet".
   */
  useFetchDocumentDetail = (documentId: string | undefined): UseFetchDocumentDetailResult => {
    const document = useDocumentStore((s) =>
      documentId ? s.documentDetailMap[documentId]?.document : undefined,
    );
    const sync = this.#detail.useSync(documentId);

    return {
      data: document,
      error: sync.error,
      isHydrated: sync.isHydrated,
      isLoading: !!documentId && document === undefined && sync.error == null,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    };
  };

  /**
   * Start a server write (e.g. a highlight-editor save) of one document and
   * return the commit that folds its confirmed result into the replica entry,
   * so the views reading it — and the next reload — show the saved revision
   * without a refetch. A read already in flight started before the write and
   * is not allowed to replace it.
   *
   * The identity (user / workspace scope) is captured here, before the request:
   * a write that settles after an account / workspace switch belongs to the
   * previous identity, so the commit is a no-op instead of planting that
   * document in the new scope's memory and IndexedDB partition.
   */
  beginDocumentDetailPatch = (documentId: string): ((patch: Partial<DocumentItem>) => void) => {
    const scope = documentDetailResource.scope.get();
    return (patch) => {
      if (documentDetailResource.scope.get() !== scope) return;
      const current = this.#get().documentDetailMap[documentId]?.document;
      if (!current) return;
      this.internal_adoptDocumentDetail(documentId, { ...current, ...patch }, scope);
    };
  };

  /**
   * Show `patch` on the document right away while `serverCall` runs. A failed
   * call rolls back to the confirmed row plus any other write still in flight,
   * so an older rejected rename never undoes a newer one.
   */
  optimisticDocumentDetail = <TResult>(
    documentId: string,
    patch: Partial<DocumentItem>,
    serverCall: () => Promise<TResult>,
  ): Promise<TResult> =>
    this.#detail.optimistic(
      documentId,
      (detail) => (detail.document ? { document: { ...detail.document, ...patch } } : detail),
      async () => {
        const scope = documentDetailResource.scope.get();
        const result = await serverCall();
        // Confirmed: a read started before this write may return the pre-write
        // row with the same `updatedAt`, so count it as an adoption (see
        // `#adoptions`) — that read keeps the committed entry instead.
        this.#countAdoption(documentId, scope);
        return result;
      },
    );

  /**
   * Warm the replica for a document the user is about to open (hover prefetch),
   * so navigation paints the editor from the projection instead of a skeleton.
   */
  prefetchDocument = async (documentId: string): Promise<void> => {
    // Goes through the replica's own fetcher (which keeps a newer adopted row)
    // and settle pipeline: a response captured under another identity is
    // dropped, and one older than a response a sync already applied — e.g. a
    // not-found the page settled while this was in flight — cannot regress it.
    try {
      await this.#detail.fetch(documentId);
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
    this.#countAdoption(documentId, scope ?? documentDetailResource.scope.get());
    this.#detail.replace(documentId, { document }, scope);
  };
}

export type DocumentAction = Pick<DocumentActionImpl, keyof DocumentActionImpl>;
