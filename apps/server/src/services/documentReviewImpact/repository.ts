import type { DocumentReviewImpactInput } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { DocumentReviewModel } from '@/database/models/documentReview';
import { documentHistories, documents } from '@/database/schemas';
import type { DocumentReviewImpactItem } from '@/database/schemas/documentReview';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';

export interface ImpactSessionRecord {
  baseHistoryId: string | null;
  documentId: string;
  id: string;
  title: string | null;
}

export interface ImpactDocumentRecord {
  content: string | null;
  editorData: Record<string, any> | null;
  id: string;
  title: string;
}

export interface ImpactHistoryRecord {
  editorData: Record<string, any>;
  id: string;
  savedAt: Date;
}

/**
 * Everything the analysis needs from storage. Kept as a port so the analysis
 * flow (diff → prompt → anchor validation → persistence order) is testable
 * without a database; {@link DrizzleImpactRepository} is the production
 * adapter and every read/write is workspace-scoped.
 */
export interface ImpactAnalysisRepository {
  findImpact: (impactId: string) => Promise<DocumentReviewImpactItem | undefined>;
  loadBaseline: (documentId: string, historyId: string) => Promise<ImpactHistoryRecord | undefined>;
  loadDocument: (documentId: string) => Promise<ImpactDocumentRecord | undefined>;
  loadSession: (sessionId: string) => Promise<ImpactSessionRecord | undefined>;
  saveImpacts: (
    sessionId: string,
    items: DocumentReviewImpactInput[],
  ) => Promise<DocumentReviewImpactItem[]>;
  setBaseline: (sessionId: string, historyId: string) => Promise<void>;
}

export class DrizzleImpactRepository implements ImpactAnalysisRepository {
  private readonly db: LobeChatDatabase;
  private readonly reviewModel: DocumentReviewModel;
  private readonly workspaceId: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
    this.reviewModel = new DocumentReviewModel(db, userId, workspaceId);
  }

  loadSession = async (sessionId: string): Promise<ImpactSessionRecord | undefined> => {
    const session = await this.reviewModel.findSessionById(sessionId);
    if (!session) return undefined;
    return {
      baseHistoryId: session.baseHistoryId,
      documentId: session.documentId,
      id: session.id,
      title: session.title,
    };
  };

  loadDocument = async (documentId: string): Promise<ImpactDocumentRecord | undefined> => {
    const [document] = await this.db
      .select({
        content: documents.content,
        editorData: documents.editorData,
        id: documents.id,
        title: documents.title,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.workspaceId, this.workspaceId),
          notTrashed(documents.isDeleted),
        ),
      )
      .limit(1);
    return document ? { ...document, title: document.title ?? '' } : undefined;
  };

  loadBaseline = async (
    documentId: string,
    historyId: string,
  ): Promise<ImpactHistoryRecord | undefined> => {
    const [history] = await this.db
      .select({
        editorData: documentHistories.editorData,
        id: documentHistories.id,
        savedAt: documentHistories.savedAt,
      })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.id, historyId),
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.workspaceId, this.workspaceId),
        ),
      )
      .limit(1);
    return history;
  };

  saveImpacts = async (
    sessionId: string,
    items: DocumentReviewImpactInput[],
  ): Promise<DocumentReviewImpactItem[]> => this.reviewModel.replaceImpacts(sessionId, items);

  setBaseline = async (sessionId: string, historyId: string): Promise<void> => {
    await this.reviewModel.updateSession(sessionId, { baseHistoryId: historyId });
  };

  findImpact = async (impactId: string): Promise<DocumentReviewImpactItem | undefined> =>
    this.reviewModel.findImpactById(impactId);
}
