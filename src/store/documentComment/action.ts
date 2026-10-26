import type {
  CreateDocumentCommentInput,
  DocumentCommentDetail,
  DocumentCommentItem,
  DocumentCommentJson,
  DocumentCommentThread,
  DocumentLikeSummary,
} from '@lobechat/types';

import { type ReplicaPagedData, type ReplicaSyncResult } from '@/libs/replica';
import { documentCommentService } from '@/services/documentComment';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type DocumentCommentState, initialState } from './initialState';
import { DocumentCommentPrivateAction } from './privateAction';
import {
  type DocumentCommentThreadScope,
  documentCommentThreadsKey,
  type DocumentCommentThreadsParams,
} from './projection';
import {
  appendReply,
  appendThread,
  raiseThreadReplyCount,
  replaceReply,
  replaceThreadRoot,
} from './reducers';
import { useDocumentCommentStore } from './store';

const n = setNamespace('documentComment');

type Setter = StoreSetter<DocumentCommentState>;

type CreatedComment = NonNullable<Awaited<ReturnType<typeof documentCommentService.create>>>;

/** The feeds a root can sit in: anchored roots in the gutter's, the rest in the list's. */
const ROOT_SCOPES: DocumentCommentThreadScope[] = ['anchored', 'document'];

/** Patch a feed's rows, keeping the feed object when no row changed. */
const patchItems =
  <TItem>(fn: (items: TItem[]) => TItem[]) =>
  <TFeed extends ReplicaPagedData<TItem, string>>(feed: TFeed): TFeed => {
    const items = fn(feed.items);
    return items === feed.items ? feed : { ...feed, items };
  };

/** Append a reply and keep the feed's live-reply `total` in step with it. */
const appendReplyToFeed =
  (comment: DocumentCommentItem) =>
  <TFeed extends ReplicaPagedData<DocumentCommentItem, string>>(feed: TFeed): TFeed => {
    const items = appendReply(feed.items, comment);
    if (items === feed.items) return feed;
    return { ...feed, items, ...(feed.total === undefined ? {} : { total: feed.total + 1 }) };
  };

/**
 * A counter overlay for one new comment: "at least what it was when the write
 * began, plus one". A `+1` would be replayed over a base an event revalidation
 * already moved past (the server counted the comment before `create()`
 * settled), and committing it would persist a count one too high.
 */
const countedOnce = (baseline: number | undefined) => (current: number) =>
  baseline === undefined ? current + 1 : Math.max(current, baseline + 1);

export interface DocumentCommentEditorValue {
  content: string;
  editorData: DocumentCommentJson;
}

export interface CreateDocumentCommentParams {
  input: CreateDocumentCommentInput;
  /** The row painted until the server answers (`createOptimisticComment`). */
  optimisticComment: DocumentCommentItem;
}

export interface CreateDocumentCommentReplyParams extends CreateDocumentCommentParams {
  rootCommentId: string;
}

/**
 * The document comment and like domain.
 *
 * Server state lives in six replicas (root feeds per scope, reply feeds,
 * comment summary, anchor list, deep-link details, like summary): each paints
 * its persisted copy on the first frame and is confirmed by the network in the
 * background. Writes go through optimistic overlays, so a failed request rolls
 * back to the confirmed value and a revalidation landing mid-request cannot
 * drop the pending row.
 */
export class DocumentCommentActionImpl {
  readonly #get: () => DocumentCommentState;
  readonly #private: DocumentCommentPrivateAction;
  readonly #set: Setter;

  constructor(
    set: Setter,
    get: () => DocumentCommentState,
    privateAction: DocumentCommentPrivateAction,
  ) {
    this.#get = get;
    this.#set = set;
    this.#private = privateAction;
  }

  // ---- server reads (replica) -------------------------------------------

  /** Hydrate + sync a document's comment count. Read `summaryMap`. */
  useFetchSummary = (documentId: string | null | undefined): ReplicaSyncResult =>
    this.#private.summary.useSync(documentId || null, { dedupingInterval: 30_000 });

  /** Hydrate + sync every anchored root of a document. Read `anchorListMap`. */
  useFetchAnchors = (documentId: string | null | undefined): ReplicaSyncResult =>
    this.#private.anchors.useSync(documentId || null);

  /** Hydrate + sync one root feed. Read `threadFeedMap`. */
  useFetchThreads = (params: DocumentCommentThreadsParams | null | undefined): ReplicaSyncResult =>
    this.#private.thread.useSync(params ?? null);

  /** Hydrate + sync the replies of one root. Read `replyFeedMap`. */
  useFetchReplies = (rootCommentId: string | null | undefined, enabled = true): ReplicaSyncResult =>
    this.#private.replies.useSync(rootCommentId ? { rootCommentId } : null, { enabled });

  /** Hydrate + sync one comment by id (a deep-link target). Read `detailMap`. */
  useFetchDetail = (commentId: string | null | undefined): ReplicaSyncResult =>
    this.#private.detail.useSync(commentId || null);

  /** Hydrate + sync a document's like summary. Read `likeSummaryMap`. */
  useFetchLikeSummary = (documentId: string | null | undefined): ReplicaSyncResult =>
    this.#private.likeSummary.useSync(documentId || null, { dedupingInterval: 30_000 });

  loadMoreThreads = (params: DocumentCommentThreadsParams) =>
    this.#private.thread.loadMore(documentCommentThreadsKey(params), params);

  loadMoreReplies = (rootCommentId: string) =>
    this.#private.replies.loadMore(rootCommentId, { rootCommentId });

  /**
   * Re-read a root feed after a write or an explicit retry. A head-only
   * revalidation keeps the already-loaded tail pages, so a change in an older
   * page would survive it — drop the tail first; the next "load more" (or the
   * gutter's eager drain) walks the pages below the head again.
   */
  revalidateThreads = (params: DocumentCommentThreadsParams) => {
    const key = documentCommentThreadsKey(params);
    this.#private.thread.collapse(key);
    return this.#private.thread.revalidate(key);
  };

  revalidateReplies = (rootCommentId: string) => {
    this.#private.replies.collapse(rootCommentId);
    return this.#private.replies.revalidate(rootCommentId);
  };

  revalidateSummary = (documentId: string) => this.#private.summary.revalidate(documentId);

  revalidateAnchors = (documentId: string) => this.#private.anchors.revalidate(documentId);

  /** Re-read one deep-link target, or every mounted one without an id. */
  revalidateDetail = (commentId?: string) => this.#private.detail.revalidate(commentId);

  /** Re-read everything a document's comment surfaces show except the reply feeds. */
  revalidateDocument = async (documentId: string) => {
    await Promise.all([
      ...ROOT_SCOPES.map((scope) => this.revalidateThreads({ documentId, scope })),
      this.revalidateSummary(documentId),
      this.revalidateAnchors(documentId),
    ]);
  };

  /**
   * Another member (or another window) changed a document's comments. The
   * event carries the affected root when it is a reply change; deep-link
   * details are few and the event does not name the comment, so every mounted
   * one is re-read.
   */
  revalidateForCommentEvent = async ({
    documentId,
    rootCommentId,
  }: {
    documentId: string;
    rootCommentId?: string;
  }) => {
    await Promise.all([
      this.revalidateDocument(documentId),
      this.revalidateDetail(),
      rootCommentId ? this.revalidateReplies(rootCommentId) : this.#private.replies.revalidate(),
    ]);
  };

  revalidateLikeSummary = (documentId: string) => this.#private.likeSummary.revalidate(documentId);

  /** Re-read the like summary now, whether or not a view is mounted (failure recovery). */
  refreshLikeSummary = (documentId: string) =>
    this.#private.likeSummary.fetch(documentId, { fresh: true });

  /**
   * Show a like / unlike right away. Memory only: the server answer replaces
   * it through {@link confirmLikeSummary}, and a reload repaints the last
   * confirmed value.
   */
  applyLikeSummary = (
    documentId: string,
    apply: (current: DocumentLikeSummary) => DocumentLikeSummary,
  ) =>
    this.#private.likeSummary.update(documentId, (current) => current && apply(current), {
      persist: false,
    });

  confirmLikeSummary = (documentId: string, summary: DocumentLikeSummary) =>
    this.#private.likeSummary.update(documentId, () => summary);

  // ---- writes ------------------------------------------------------------

  /**
   * Create a root comment. It shows at the end of its feed (anchored or
   * document-level, by its selection anchor) and in the count right away; a
   * failed request rolls both back and rethrows.
   */
  createRootComment = async ({
    input,
    optimisticComment,
  }: CreateDocumentCommentParams): Promise<CreatedComment> => {
    const { documentId } = input;
    const threadParams: DocumentCommentThreadsParams = {
      documentId,
      scope: input.selectionAnchor ? 'anchored' : 'document',
    };
    const key = documentCommentThreadsKey(threadParams);
    // An optimistic write onto a feed that has no view yet (still loading, or
    // its fetch failed) is dropped, so the created row would stay invisible.
    const threadUnloaded = !this.#get().threadFeedMap[key];
    const thread = this.#private.thread.beginOptimistic(
      key,
      patchItems<DocumentCommentThread>((threads) => appendThread(threads, optimisticComment)),
    );
    const summaryTotal = countedOnce(this.#get().summaryMap[documentId]?.total);
    const summary = this.#private.summary.beginOptimistic(documentId, (current) => ({
      ...current,
      total: summaryTotal(current.total),
    }));

    let created: CreatedComment;
    try {
      const result = await documentCommentService.create(input);
      if (!result) throw new Error('Document comment creation returned no result');
      created = result;
    } catch (error) {
      thread.rollback();
      summary.rollback();
      throw error;
    }

    thread.commit(
      patchItems<DocumentCommentThread>((threads) => appendThread(threads, created.comment)),
    );
    if (threadUnloaded) void this.revalidateThreads(threadParams);
    // A retried submit the server already had: the count did not grow.
    if (created.isDuplicate) summary.rollback();
    else summary.commit();
    // Converge on the server's count (another member may have commented meanwhile).
    void this.revalidateSummary(documentId);

    // The body paints from the document-wide anchor list, so the new root
    // joins it now rather than on the next revalidation.
    const createdAnchor = created.comment.selectionAnchor;
    if (createdAnchor) {
      this.#private.anchors.update(documentId, (current) =>
        current && !current.items.some(({ id }) => id === created.comment.id)
          ? {
              items: [...current.items, { id: created.comment.id, selectionAnchor: createdAnchor }],
            }
          : current,
      );
    }
    return created;
  };

  /**
   * Reply inside a thread. The reply, its root's reply count (in the feeds and
   * in a pinned deep-link root) and the document count move together, and
   * roll back together when the request fails.
   */
  createReply = async ({
    input,
    optimisticComment,
    rootCommentId,
  }: CreateDocumentCommentReplyParams): Promise<CreatedComment> => {
    const { documentId } = input;
    // See createRootComment: a feed with no view drops the optimistic write.
    const repliesUnloaded = !this.#get().replyFeedMap[rootCommentId];
    const replies = this.#private.replies.beginOptimistic(
      rootCommentId,
      appendReplyToFeed(optimisticComment),
    );
    // Baselines are read now, before the request: see `countedOnce`.
    const state = this.#get();
    const replyCountOf = (scope: DocumentCommentThreadScope) =>
      state.threadFeedMap[documentCommentThreadsKey({ documentId, scope })]?.items.find(
        ({ root }) => root.id === rootCommentId,
      )?.replyCount;
    const detailReplyCount = countedOnce(state.detailMap[rootCommentId]?.replyCount);
    const summaryTotal = countedOnce(state.summaryMap[documentId]?.total);
    const counts = [
      ...ROOT_SCOPES.map((scope) => {
        const baseline = replyCountOf(scope);
        return this.#private.thread.beginOptimistic(
          documentCommentThreadsKey({ documentId, scope }),
          patchItems<DocumentCommentThread>((threads) => {
            const current = threads.find(({ root }) => root.id === rootCommentId)?.replyCount;
            return current === undefined
              ? threads
              : raiseThreadReplyCount(threads, rootCommentId, countedOnce(baseline)(current));
          }),
        );
      }),
      this.#private.detail.beginOptimistic(rootCommentId, (detail) => ({
        ...detail,
        replyCount: detailReplyCount(detail.replyCount),
      })),
      this.#private.summary.beginOptimistic(documentId, (current) => ({
        ...current,
        total: summaryTotal(current.total),
      })),
    ];

    let created: CreatedComment;
    try {
      const result = await documentCommentService.create(input);
      if (!result) throw new Error('Document comment reply creation returned no result');
      created = result;
    } catch (error) {
      replies.rollback();
      for (const token of counts) token.rollback();
      throw error;
    }

    replies.commit(appendReplyToFeed(created.comment));
    if (repliesUnloaded) void this.revalidateReplies(rootCommentId);
    if (created.isDuplicate) {
      for (const token of counts) token.rollback();
      void this.revalidateReplies(rootCommentId);
      void this.revalidateDetail(rootCommentId);
      void this.revalidateDocument(documentId);
    } else {
      for (const token of counts) token.commit();
      // Converge on the server's count (another member may have commented meanwhile).
      void this.revalidateSummary(documentId);
    }
    return created;
  };

  /**
   * Edit a root or a reply. The new content shows wherever the comment is
   * painted (its feed and a pinned deep-link copy); a failed request rolls
   * every copy back and rethrows.
   */
  updateComment = async (
    comment: DocumentCommentItem,
    value: DocumentCommentEditorValue,
  ): Promise<DocumentCommentItem> => {
    const optimisticComment: DocumentCommentItem = { ...comment, ...value, updatedAt: new Date() };
    const { replies, thread, detail } = this.#private;
    const rootKeys = ROOT_SCOPES.map((scope) =>
      documentCommentThreadsKey({ documentId: comment.documentId, scope }),
    );
    const replyKey = comment.parentCommentId;
    const replaceInReplies = (next: DocumentCommentItem) =>
      patchItems<DocumentCommentItem>((items) => replaceReply(items, next));
    const replaceInThreads = (next: DocumentCommentItem) =>
      patchItems<DocumentCommentThread>((threads) => replaceThreadRoot(threads, next));
    const patchDetail = (next: DocumentCommentItem) => (current: DocumentCommentDetail) => ({
      ...current,
      ...next,
      replyCount: current.replyCount,
    });
    // A reply lives in its root's reply feed; a root in one of the two root feeds.
    const replyToken = replyKey
      ? replies.beginOptimistic(replyKey, replaceInReplies(optimisticComment))
      : undefined;
    const threadTokens = replyKey
      ? []
      : rootKeys.map((key) => thread.beginOptimistic(key, replaceInThreads(optimisticComment)));
    const detailToken = detail.beginOptimistic(comment.id, patchDetail(optimisticComment));

    let updated: DocumentCommentItem;
    try {
      const result = await documentCommentService.update({ ...value, id: comment.id });
      if (!result) throw new Error('Document comment update returned no result');
      updated = result;
    } catch (error) {
      replyToken?.rollback();
      for (const token of threadTokens) token.rollback();
      detailToken.rollback();
      throw error;
    }

    // Settle on the server's row (its `updatedAt`, normalized content).
    replyToken?.commit(replaceInReplies(updated));
    for (const token of threadTokens) token.commit(replaceInThreads(updated));
    detailToken.commit(patchDetail(updated));
    return updated;
  };

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useDocumentCommentStore;

export const documentCommentActions = new DocumentCommentActionImpl(
  setState,
  getState,
  new DocumentCommentPrivateAction(setState, getState),
);
