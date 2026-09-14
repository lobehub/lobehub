import type {
  DocumentAnnotationInput,
  DocumentAnnotationPatch,
  ListDocumentAnnotationsOptions,
} from '@/database/models/documentAnnotation';
import {
  DocumentAnnotationModel,
  documentAnnotationRecordFromRow,
  documentAnnotationRecordsFromRows,
} from '@/database/models/documentAnnotation';
import type { DocumentAnnotationStatus } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/** Wire shape shared with the editor's external AnnotationService repository. */
export type DocumentAnnotationRecord = ReturnType<typeof documentAnnotationRecordFromRow>;

export class DocumentAnnotationService {
  private readonly model: DocumentAnnotationModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.model = new DocumentAnnotationModel(db, userId, workspaceId);
  }

  listByDocument = async (
    documentId: string,
    options: ListDocumentAnnotationsOptions = {},
  ): Promise<DocumentAnnotationRecord[]> =>
    documentAnnotationRecordsFromRows(await this.model.listByDocument(documentId, options));

  findById = async (
    documentId: string,
    id: string,
  ): Promise<DocumentAnnotationRecord | undefined> => {
    const row = await this.model.findById(documentId, id);
    return row ? documentAnnotationRecordFromRow(row) : undefined;
  };

  create = async (documentId: string, input: DocumentAnnotationInput) => {
    const result = await this.model.create(documentId, input);
    return {
      annotation: documentAnnotationRecordFromRow(result.annotation),
      isDuplicate: result.isDuplicate,
    };
  };

  upsert = async (documentId: string, input: DocumentAnnotationInput, expectedVersion?: number) => {
    const result = await this.model.upsert(documentId, input, expectedVersion);
    return {
      annotation: documentAnnotationRecordFromRow(result.annotation),
      isDuplicate: result.isDuplicate,
    };
  };

  bulkUpsertLegacy = async (documentId: string, records: DocumentAnnotationInput[]) => {
    const result = await this.model.bulkUpsertLegacy(documentId, records);
    return {
      annotations: documentAnnotationRecordsFromRows(result.annotations),
      createdCount: result.createdCount,
      unchangedCount: result.unchangedCount,
      updatedCount: result.updatedCount,
    };
  };

  update = async (
    documentId: string,
    id: string,
    patch: DocumentAnnotationPatch,
    expectedVersion?: number,
  ) => ({
    annotation: documentAnnotationRecordFromRow(
      await this.model.update(documentId, id, patch, expectedVersion),
    ),
  });

  updateStatus = async (
    documentId: string,
    id: string,
    status: DocumentAnnotationStatus,
    expectedVersion?: number,
  ) => ({
    annotation: documentAnnotationRecordFromRow(
      await this.model.updateStatus(documentId, id, status, expectedVersion),
    ),
  });

  softDelete = async (documentId: string, id: string, expectedVersion?: number) => ({
    annotation: documentAnnotationRecordFromRow(
      await this.model.softDelete(documentId, id, expectedVersion),
    ),
  });

  remove = this.softDelete;
}
