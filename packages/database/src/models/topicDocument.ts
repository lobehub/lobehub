import {
  AGENT_DOCUMENT_FILE_TYPE,
  CUSTOM_DOCUMENT_FILE_TYPE,
  MARKDOWN_DOCUMENT_FILE_TYPES,
} from '@lobechat/const';
import type { DocumentAccessScope } from '@lobechat/types';
import { ordinaryDocumentAccessScope } from '@lobechat/types';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DocumentItem, NewTopicDocument } from '../schemas';
import { documents, topicDocuments } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { documentMatchesAccessScope } from '../utils/documentVisibility';
import { buildWorkspaceWhere } from '../utils/workspace';

export interface TopicDocumentWithDetails extends DocumentItem {
  associatedAt: Date;
}

/**
 * Kinds that are all the same document: the surfaces' own names for a plain text
 * document whose content is its bytes. The notebook writes the unlabelled
 * default as `markdown`, the agent-documents surface writes `agent/document`,
 * and a Page is `custom/document` — so a report written through two of them is
 * one document, not two.
 *
 * The notebook's *labelled* kinds — `article`, `note`, `report` — are absent on
 * purpose. A caller that asks for one of them asked for that kind, so it is
 * matched and read exactly: letting a `note` write be answered by a markdown row
 * would report success and then leave `listDocuments({ type: 'note' })` with
 * nothing to return.
 *
 * A structured artifact is absent for the same reason, one step further:
 * `agent/plan` is *found* by its type (`findPlanByTopic` filters on it).
 */
export const SAME_DOCUMENT_KIND_FILE_TYPES = [
  ...MARKDOWN_DOCUMENT_FILE_TYPES,
  AGENT_DOCUMENT_FILE_TYPE,
  CUSTOM_DOCUMENT_FILE_TYPE,
];

/**
 * Every kind a document of `fileType` may be stored as: the whole equivalent set
 * for a plain document, the kind itself for anything with a name of its own.
 *
 * Both the twin search and {@link TopicDocumentModel.findByTopicId}'s kind
 * filter read this, so the two cannot disagree — a document is always findable
 * under the kind its writer asked for.
 */
export const documentFileTypesOfKind = (fileType: string): string[] =>
  SAME_DOCUMENT_KIND_FILE_TYPES.includes(fileType) ? SAME_DOCUMENT_KIND_FILE_TYPES : [fileType];

export class TopicDocumentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  private documentAccessScope: DocumentAccessScope;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    documentAccessScope: DocumentAccessScope = ordinaryDocumentAccessScope,
  ) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.documentAccessScope = documentAccessScope;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topicDocuments);

  /**
   * Associate a document with a topic.
   *
   * Idempotent: the primary key is `(documentId, topicId)`, so re-binding the
   * same pair is a no-op via `ON CONFLICT DO NOTHING` instead of a
   * unique-violation. Callers can safely retry or call this on every save
   * without checking existence first.
   */
  associate = async (
    params: Omit<NewTopicDocument, 'userId'>,
  ): Promise<{ documentId: string; topicId: string }> => {
    await this.db
      .insert(topicDocuments)
      .values({ ...params, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .onConflictDoNothing();

    return { documentId: params.documentId, topicId: params.topicId };
  };

  /**
   * Remove association between a document and a topic
   */
  disassociate = async (documentId: string, topicId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(
        and(
          eq(topicDocuments.documentId, documentId),
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
        ),
      );
  };

  /**
   * Get all documents associated with a topic.
   *
   * The junction table doesn't carry a `visibility` column, so its
   * `ownership()` only matches the current workspace. Without a second
   * visibility guard on the joined `documents` row, a private document
   * previously shared into a workspace-visible topic would leak back to
   * every workspace member after its creator flipped it to `private` via
   * `setVisibility`. Apply `buildWorkspaceWhere` on `documents`
   * so the join drops rows the current viewer can no longer read — they
   * simply disappear from the sidebar list.
   */
  findByTopicId = async (
    topicId: string,
    filter?: { type?: string },
  ): Promise<TopicDocumentWithDetails[]> => {
    const results = await this.db
      .select({
        associatedAt: topicDocuments.createdAt,
        document: documents,
      })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, topicId),
          this.ownership(),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          documentMatchesAccessScope(documents.metadata, this.documentAccessScope),
          filter?.type
            ? inArray(documents.fileType, documentFileTypesOfKind(filter.type))
            : undefined,
        ),
      )
      .orderBy(desc(topicDocuments.createdAt));

    return results.map((r) => ({
      ...r.document,
      associatedAt: r.associatedAt,
    }));
  };

  /**
   * A document this topic already holds under the same title, the same body and
   * the same kind.
   *
   * The notebook surface and the agent-documents surface answer one intent with
   * two tools, and an agent that writes the same report through both used to
   * leave two rows behind: two entries in the topic's document list and two
   * deliverable cards on the goal graph, for one report. A matching title alone
   * is weak (two documents may share one), so the body has to match too —
   * byte-identical identity plus byte-identical content is the same document
   * written twice, and the second write reuses the row.
   *
   * The kind is part of that identity, because a document can be *found* by its
   * type: `findPlanByTopic` filters on `agent/plan`, and the notebook's labelled
   * kinds are filtered by callers too. Two plain documents that agree are still
   * one (see {@link SAME_DOCUMENT_KIND_FILE_TYPES}); a plan write must never be
   * answered with the page that happens to hold the same text, and neither must
   * a `note` write be answered by a markdown row.
   */
  findVerbatimTwin = async (params: {
    content: string;
    fileType: string;
    title: string;
    topicId: string;
  }): Promise<DocumentItem | undefined> => {
    const [twin] = await this.db
      .select({ document: documents })
      .from(topicDocuments)
      .innerJoin(documents, eq(topicDocuments.documentId, documents.id))
      .where(
        and(
          eq(topicDocuments.topicId, params.topicId),
          eq(documents.title, params.title),
          eq(documents.content, params.content),
          inArray(documents.fileType, documentFileTypesOfKind(params.fileType)),
          this.ownership(),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          documentMatchesAccessScope(documents.metadata, this.documentAccessScope),
        ),
      )
      .orderBy(desc(topicDocuments.createdAt))
      .limit(1);

    return twin?.document;
  };

  /**
   * Get all topics associated with a document
   */
  findByDocumentId = async (documentId: string): Promise<string[]> => {
    const results = await this.db
      .select({ topicId: topicDocuments.topicId })
      .from(topicDocuments)
      .where(and(eq(topicDocuments.documentId, documentId), this.ownership()));

    return results.map((r) => r.topicId);
  };

  /**
   * Check if a document is associated with a topic
   */
  isAssociated = async (documentId: string, topicId: string): Promise<boolean> => {
    const result = await this.db.query.topicDocuments.findFirst({
      where: and(
        eq(topicDocuments.documentId, documentId),
        eq(topicDocuments.topicId, topicId),
        this.ownership(),
      ),
    });

    return !!result;
  };

  /**
   * Remove all associations for a topic
   */
  deleteByTopicId = async (topicId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(and(eq(topicDocuments.topicId, topicId), this.ownership()));
  };

  /**
   * Remove all associations for a document
   */
  deleteByDocumentId = async (documentId: string) => {
    return this.db
      .delete(topicDocuments)
      .where(and(eq(topicDocuments.documentId, documentId), this.ownership()));
  };
}
