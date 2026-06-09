import { z } from 'zod';

export const documentHistorySaveSourceSchema = z.enum([
  'autosave',
  'manual',
  'restore',
  'system',
  'llm_call',
]);

export const listDocumentHistoryInputSchema = z
  .object({
    beforeId: z.string().optional(),
    beforeSavedAt: z.string().datetime().optional(),
    documentId: z.string(),
    includeCurrent: z.boolean().optional(),
    limit: z.number().int().min(1).optional(),
  })
  .refine(
    (data) => (!data.beforeId && !data.beforeSavedAt) || (!!data.beforeId && !!data.beforeSavedAt),
    {
      message: 'beforeId and beforeSavedAt must be provided together',
      path: ['beforeSavedAt'],
    },
  );

export const getDocumentHistoryItemInputSchema = z.object({
  documentId: z.string(),
  historyId: z.string(),
});

export const compareDocumentHistoryItemsInputSchema = z.object({
  documentId: z.string(),
  fromHistoryId: z.string(),
  toHistoryId: z.string(),
});

export const updateDocumentInputSchema = z.object({
  content: z.string().optional(),
  editorData: z.string().optional(),
  fileType: z.string().optional(),
  id: z.string(),
  metadata: z.record(z.any()).optional(),
  parentId: z.string().nullable().optional(),
  restoreFromHistoryId: z.string().optional(),
  saveSource: documentHistorySaveSourceSchema.optional(),
  title: z.string().optional(),
});

export const saveDocumentHistoryInputSchema = z.object({
  documentId: z.string(),
  editorData: z.string(),
  saveSource: documentHistorySaveSourceSchema,
});

export interface DocumentHistoryListItem {
  id: string;
  isCurrent: boolean;
  savedAt: string;
  saveSource: DocumentHistorySaveSource;
}

export interface ListHistoryOutput {
  items: DocumentHistoryListItem[];
  nextBeforeId?: string;
  nextBeforeSavedAt?: string;
}

export interface GetHistoryItemOutput {
  editorData: Record<string, any> | null;
  id: string;
  isCurrent: boolean;
  savedAt: string;
  saveSource: DocumentHistorySaveSource;
}

export interface CompareHistoryItemState {
  editorData: Record<string, any> | null;
  id: string;
  isCurrent: boolean;
  savedAt: string;
  saveSource: DocumentHistorySaveSource;
}

export interface CompareHistoryItemsOutput {
  from: CompareHistoryItemState;
  to: CompareHistoryItemState;
}

export interface UpdateDocumentOutput {
  historyAppended: boolean;
  id: string;
  savedAt?: string;
}

export interface SaveDocumentHistoryInput {
  documentId: string;
  editorData: string;
  saveSource: DocumentHistorySaveSource;
}

export interface SaveDocumentHistoryOutput {
  savedAt: string;
}

export interface ListHistoryInput {
  beforeId?: string;
  beforeSavedAt?: string;
  documentId: string;
  includeCurrent?: boolean;
  limit?: number;
}

export interface GetHistoryItemInput {
  documentId: string;
  historyId: string;
}

export interface CompareHistoryItemsInput {
  documentId: string;
  fromHistoryId: string;
  toHistoryId: string;
}

export interface UpdateDocumentInput {
  content?: string;
  editorData?: string;
  fileType?: string;
  id: string;
  metadata?: Record<string, any>;
  parentId?: string | null;
  restoreFromHistoryId?: string;
  saveSource?: DocumentHistorySaveSource;
  title?: string;
}

export interface DocumentHistoryRouterService {
  compareDocumentHistoryItems: (
    params: CompareHistoryItemsInput,
  ) => Promise<CompareHistoryItemsOutput>;
  getDocumentHistoryItem: (params: GetHistoryItemInput) => Promise<GetHistoryItemOutput>;
  listDocumentHistory: (params: ListHistoryInput) => Promise<ListHistoryOutput>;
  saveDocumentHistory: (params: SaveDocumentHistoryInput) => Promise<SaveDocumentHistoryOutput>;
  updateDocument: (
    id: string,
    params: Omit<UpdateDocumentInput, 'id'>,
  ) => Promise<UpdateDocumentOutput>;
}

export type DocumentHistorySaveSource = z.infer<typeof documentHistorySaveSourceSchema>;
