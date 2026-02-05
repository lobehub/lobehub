import type { QueryFileListParams } from '@lobechat/types';
import { FilesTabs, SortType } from '@lobechat/types';
import { sql } from 'drizzle-orm';

import { DocumentModel } from '../../models/document';
import { FileModel } from '../../models/file';
import { documents, files, knowledgeBaseFiles } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export interface KnowledgeItem {
  chunkTaskId?: string | null;
  content?: string | null;
  createdAt: Date;
  editorData?: Record<string, any> | null;
  embeddingTaskId?: string | null;
  fileType: string;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  size: number;
  slug?: string | null;
  /**
   * Source type to distinguish between files and documents
   * - 'file': from files table
   * - 'document': from documents table
   */
  sourceType: 'file' | 'document';
  updatedAt: Date;
  url?: string;
}

/**
 * Resources Repository - combines files and documents into a unified interface
 */
export class KnowledgeRepo {
  private userId: string;
  private db: LobeChatDatabase;
  private fileModel: FileModel;
  private documentModel: DocumentModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.fileModel = new FileModel(db, userId);
    this.documentModel = new DocumentModel(db, userId);
  }

  /**
   * Query combined results from files and documents tables
   */
  async query({
    category,
    q,
    sortType,
    sorter,
    knowledgeBaseId,
    showFilesInKnowledgeBase,
    parentId,
    limit = 50,
    offset = 0,
  }: QueryFileListParams = {}): Promise<KnowledgeItem[]> {
    // If parentId is provided, check if it's a slug and resolve it to an ID
    let resolvedParentId = parentId;
    if (parentId) {
      // Try to find a document with this slug
      const docBySlug = await this.documentModel.findBySlug(parentId);
      if (docBySlug) {
        resolvedParentId = docBySlug.id;
      }
      // Otherwise assume it's already an ID
    }

    // Build file query
    const fileQuery = this.buildFileQuery({
      category,
      knowledgeBaseId,
      parentId: resolvedParentId,
      q,
      showFilesInKnowledgeBase,
      sortType,
      sorter,
    });

    // Build document query (notes)
    const documentQuery = this.buildDocumentQuery({
      category,
      knowledgeBaseId,
      parentId: resolvedParentId,
      q,
      sortType,
      sorter,
    });

    // Combine both queries with UNION ALL
    const combinedQuery = sql`
      (${fileQuery})
      UNION ALL
      (${documentQuery})
    `;

    // Add final ordering and pagination
    const orderClause = this.buildOrderClause(sortType, sorter);
    const finalQuery = sql`
      SELECT * FROM (${combinedQuery}) as combined
      ORDER BY ${orderClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const result = await this.db.execute(finalQuery);

    const mappedResults = result.rows.map((row: any) => {
      // Parse editor_data if it's a string (raw SQL returns JSONB as string)
      let editorData = row.editor_data;
      if (typeof editorData === 'string') {
        try {
          editorData = JSON.parse(editorData);
        } catch (e) {
          console.error('[KnowledgeRepo] Failed to parse editor_data:', e);
          editorData = null;
        }
      }

      // Parse metadata if it's a string (raw SQL returns JSONB as string)
      let metadata = row.metadata;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          console.error('[KnowledgeRepo] Failed to parse metadata:', e);
          metadata = null;
        }
      }

      return {
        chunkTaskId: row.chunk_task_id,
        content: row.content,
        createdAt: new Date(row.created_at),
        editorData,
        embeddingTaskId: row.embedding_task_id,
        fileType: row.file_type,
        id: row.id,
        metadata,
        name: row.name,
        size: Number(row.size),
        slug: row.slug,
        sourceType: row.source_type,
        updatedAt: new Date(row.updated_at),
        url: row.url,
      };
    });

    return mappedResults;
  }

  /**
   * Query recent items (files and documents)
   * Returns the most recently updated items
   */
  async queryRecent(limit: number = 12): Promise<KnowledgeItem[]> {
    const fileQuery = sql`
      SELECT
        COALESCE(d.id, f.id) as id,
        f.name,
        f.file_type,
        f.size,
        f.url,
        f.created_at,
        f.updated_at,
        f.chunk_task_id,
        f.embedding_task_id,
        d.editor_data,
        d.content,
        d.slug,
        COALESCE(d.metadata, f.metadata) as metadata,
        'file' as source_type
      FROM ${files} f
      LEFT JOIN ${documents} d
        ON f.id = d.file_id
      WHERE f.user_id = ${this.userId}
        AND NOT EXISTS (
          SELECT 1 FROM ${knowledgeBaseFiles}
          WHERE ${knowledgeBaseFiles.fileId} = f.id
        )
    `;

    const documentQuery = sql`
      SELECT
        id,
        COALESCE(title, filename, 'Untitled') as name,
        file_type,
        total_char_count as size,
        source as url,
        created_at,
        updated_at,
        NULL as chunk_task_id,
        NULL as embedding_task_id,
        editor_data,
        content,
        slug,
        metadata,
        'document' as source_type
      FROM ${documents}
      WHERE user_id = ${this.userId}
        AND source_type != ${'file'}
        AND knowledge_base_id IS NULL
    `;

    const combinedQuery = sql`
      SELECT * FROM (
        (${fileQuery})
        UNION ALL
        (${documentQuery})
      ) as combined
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;

    const result = await this.db.execute(combinedQuery);

    const mappedResults = result.rows.map((row: any) => {
      // Parse editor_data if it's a string
      let editorData = row.editor_data;
      if (typeof editorData === 'string') {
        try {
          editorData = JSON.parse(editorData);
        } catch {
          editorData = null;
        }
      }

      // Parse metadata if it's a string
      let metadata = row.metadata;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch {
          metadata = null;
        }
      }

      return {
        chunkTaskId: row.chunk_task_id,
        content: row.content,
        createdAt: new Date(row.created_at),
        editorData,
        embeddingTaskId: row.embedding_task_id,
        fileType: row.file_type,
        id: row.id,
        metadata,
        name: row.name,
        size: Number(row.size),
        slug: row.slug,
        sourceType: row.source_type,
        updatedAt: new Date(row.updated_at),
        url: row.url,
      };
    });

    return mappedResults;
  }

  /**
   * Delete item by id - routes to appropriate model based on sourceType
   */
  async deleteItem(id: string, sourceType: 'file' | 'document'): Promise<void> {
    if (sourceType === 'file') {
      await this.fileModel.delete(id);
    } else {
      await this.documentModel.delete(id);
    }
  }

  /**
   * Batch delete items
   */
  async deleteMany(items: Array<{ id: string; sourceType: 'file' | 'document' }>): Promise<void> {
    const fileIds = items.filter((item) => item.sourceType === 'file').map((item) => item.id);
    const documentIds = items
      .filter((item) => item.sourceType === 'document')
      .map((item) => item.id);

    await Promise.all([
      fileIds.length > 0 ? this.fileModel.deleteMany(fileIds) : Promise.resolve(),
      documentIds.length > 0
        ? Promise.all(documentIds.map((id) => this.documentModel.delete(id)))
        : Promise.resolve(),
    ]);
  }

  /**
   * Find item by id
   */
  async findById(id: string, sourceType: 'file' | 'document'): Promise<any> {
    if (sourceType === 'file') {
      return this.fileModel.findById(id);
    } else {
      return this.documentModel.findById(id);
    }
  }

  private buildFileQuery({
    category,
    q,
    knowledgeBaseId,
    showFilesInKnowledgeBase,
    parentId,
  }: QueryFileListParams = {}): ReturnType<typeof sql> {
    const whereConditions: any[] = [sql`f.user_id = ${this.userId}`];

    // Parent ID filter
    if (parentId !== undefined) {
      if (parentId === null) {
        whereConditions.push(sql`f.parent_id IS NULL`);
      } else {
        whereConditions.push(sql`f.parent_id = ${parentId}`);
      }
    }

    // Search filter
    if (q) {
      whereConditions.push(sql`f.name ILIKE ${`%${q}%`}`);
    }

    // Category filter
    if (category && category !== FilesTabs.All) {
      const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
      if (Array.isArray(fileTypePrefix)) {
        // For multiple file types (e.g., Documents includes 'application' and 'custom')
        const orConditions = fileTypePrefix.map((prefix) => sql`f.file_type ILIKE ${`${prefix}%`}`);
        whereConditions.push(sql`(${sql.join(orConditions, sql` OR `)})`);
      } else {
        whereConditions.push(sql`f.file_type ILIKE ${`${fileTypePrefix}%`}`);
      }
    }

    // Knowledge base filter
    if (knowledgeBaseId) {
      // Build where conditions using proper table references (f.column instead of files.column)
      const kbWhereConditions: any[] = [sql`f.user_id = ${this.userId}`];

      // Parent ID filter
      if (parentId !== undefined) {
        if (parentId === null) {
          kbWhereConditions.push(sql`f.parent_id IS NULL`);
        } else {
          kbWhereConditions.push(sql`f.parent_id = ${parentId}`);
        }
      }

      // Search filter
      if (q) {
        kbWhereConditions.push(sql`f.name ILIKE ${`%${q}%`}`);
      }

      // Category filter
      if (category && category !== FilesTabs.All && category !== FilesTabs.Home) {
        const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
        if (Array.isArray(fileTypePrefix)) {
          const orConditions = fileTypePrefix.map(
            (prefix) => sql`f.file_type ILIKE ${`${prefix}%`}`,
          );
          kbWhereConditions.push(sql`(${sql.join(orConditions, sql` OR `)})`);
        } else {
          kbWhereConditions.push(sql`f.file_type ILIKE ${`${fileTypePrefix}%`}`);
        }
      }

      return sql`
        SELECT
          COALESCE(d.id, f.id) as id,
          f.name,
          f.file_type,
          f.size,
          f.url,
          f.created_at,
          f.updated_at,
          f.chunk_task_id,
          f.embedding_task_id,
          d.editor_data,
          d.content,
          d.slug,
          COALESCE(d.metadata, f.metadata) as metadata,
          'file' as source_type
        FROM ${files} f
        INNER JOIN ${knowledgeBaseFiles} kbf
          ON f.id = kbf.file_id
          AND kbf.knowledge_base_id = ${knowledgeBaseId}
        LEFT JOIN ${documents} d
          ON f.id = d.file_id
        WHERE ${sql.join(kbWhereConditions, sql` AND `)}
      `;
    }

    // Exclude files in knowledge base if needed
    if (!showFilesInKnowledgeBase) {
      whereConditions.push(
        sql`
          NOT EXISTS (
                    SELECT 1 FROM ${knowledgeBaseFiles}
                    WHERE ${knowledgeBaseFiles.fileId} = f.id
                  )
        `,
      );
    }

    return sql`
      SELECT
        COALESCE(d.id, f.id) as id,
        f.name,
        f.file_type,
        f.size,
        f.url,
        f.created_at,
        f.updated_at,
        f.chunk_task_id,
        f.embedding_task_id,
        d.editor_data,
        d.content,
        d.slug,
        COALESCE(d.metadata, f.metadata) as metadata,
        'file' as source_type
      FROM ${files} f
      LEFT JOIN ${documents} d
        ON f.id = d.file_id
      WHERE ${sql.join(whereConditions, sql` AND `)}
    `;
  }

  private buildDocumentQuery({
    category,
    q,
    knowledgeBaseId,
    parentId,
  }: QueryFileListParams = {}): ReturnType<typeof sql> {
    const whereConditions: any[] = [
      sql`${documents.userId} = ${this.userId}`,
      sql`${documents.sourceType} != ${'file'}`,
    ];

    // Parent ID filter
    if (parentId !== undefined) {
      if (parentId === null) {
        whereConditions.push(sql`${documents.parentId} IS NULL`);
      } else {
        whereConditions.push(sql`${documents.parentId} = ${parentId}`);
      }
    }

    // Search filter
    if (q) {
      whereConditions.push(
        sql`(${documents.title} ILIKE ${`%${q}%`} OR ${documents.filename} ILIKE ${`%${q}%`})`,
      );
    }

    // Category filter - match documents by fileType prefix
    if (category && category !== FilesTabs.All) {
      const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
      if (Array.isArray(fileTypePrefix)) {
        // For multiple file types (e.g., Documents includes 'application' and 'custom')
        const orConditions = fileTypePrefix.map(
          (prefix) => sql`${documents.fileType} ILIKE ${`${prefix}%`}`,
        );
        whereConditions.push(sql`(${sql.join(orConditions, sql` OR `)})`);

        // Exclude custom/document from Documents category
        if (category === FilesTabs.Documents) {
          whereConditions.push(sql`${documents.fileType} != ${'custom/document'}`);
        }
      } else if (fileTypePrefix) {
        whereConditions.push(sql`${documents.fileType} ILIKE ${`${fileTypePrefix}%`}`);
      } else {
        // Exclude documents from other categories (Images, Videos, Audios, Websites)
        return sql`
          SELECT
            NULL::varchar(30) as id,
            NULL::text as name,
            NULL::varchar(255) as file_type,
            NULL::integer as size,
            NULL::text as url,
            NULL::timestamp with time zone as created_at,
            NULL::timestamp with time zone as updated_at,
            NULL::uuid as chunk_task_id,
            NULL::uuid as embedding_task_id,
            NULL::jsonb as editor_data,
            NULL::text as content,
            NULL::varchar(255) as slug,
            NULL::jsonb as metadata,
            NULL::text as source_type
          WHERE false
        `;
      }
    }

    // Knowledge base filter for documents
    // Documents are linked to knowledge bases through files table via fileId
    if (knowledgeBaseId) {
      // Build where conditions using proper table references (d.column instead of documents.column)
      const kbWhereConditions: any[] = [sql`d.user_id = ${this.userId}`];

      // Parent ID filter
      if (parentId !== undefined) {
        if (parentId === null) {
          kbWhereConditions.push(sql`d.parent_id IS NULL`);
        } else {
          kbWhereConditions.push(sql`d.parent_id = ${parentId}`);
        }
      }

      // Search filter
      if (q) {
        kbWhereConditions.push(sql`(d.title ILIKE ${`%${q}%`} OR d.filename ILIKE ${`%${q}%`})`);
      }

      // Category filter
      if (category && category !== FilesTabs.All) {
        const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
        if (Array.isArray(fileTypePrefix)) {
          const orConditions = fileTypePrefix.map(
            (prefix) => sql`d.file_type ILIKE ${`${prefix}%`}`,
          );
          kbWhereConditions.push(sql`(${sql.join(orConditions, sql` OR `)})`);

          // Exclude custom/document and source_type='file' from Documents category
          if (category === FilesTabs.Documents) {
            kbWhereConditions.push(
              sql`d.file_type != ${'custom/document'}`,
              sql`d.source_type != ${'file'}`,
            );
          }
        } else if (fileTypePrefix) {
          kbWhereConditions.push(sql`d.file_type ILIKE ${`${fileTypePrefix}%`}`);
        } else {
          // Exclude documents from other categories (Images, Videos, Audios, Websites)
          return sql`
            SELECT
              NULL::varchar(30) as id,
              NULL::text as name,
              NULL::varchar(255) as file_type,
              NULL::integer as size,
              NULL::text as url,
              NULL::timestamp with time zone as created_at,
              NULL::timestamp with time zone as updated_at,
              NULL::uuid as chunk_task_id,
              NULL::uuid as embedding_task_id,
              NULL::jsonb as editor_data,
              NULL::text as content,
              NULL::varchar(255) as slug,
              NULL::jsonb as metadata,
              NULL::text as source_type
            WHERE false
          `;
        }
      }

      // When in a knowledge base, return standalone documents (folders and notes without fileId)
      // that have the knowledgeBaseId column set. Documents with fileId are already
      // returned by the file query via their linked file records.
      kbWhereConditions.push(sql`d.file_id IS NULL`, sql`d.knowledge_base_id = ${knowledgeBaseId}`);

      return sql`
        SELECT
          d.id,
          COALESCE(d.title, d.filename, 'Untitled') as name,
          d.file_type,
          d.total_char_count as size,
          d.source as url,
          d.created_at,
          d.updated_at,
          NULL as chunk_task_id,
          NULL as embedding_task_id,
          d.editor_data,
          d.content,
          d.slug,
          d.metadata,
          'document' as source_type
        FROM ${documents} d
        WHERE ${sql.join(kbWhereConditions, sql` AND `)}
      `;
    }

    return sql`
      SELECT
        id,
        COALESCE(title, filename, 'Untitled') as name,
        file_type,
        total_char_count as size,
        source as url,
        created_at,
        updated_at,
        NULL as chunk_task_id,
        NULL as embedding_task_id,
        editor_data,
        content,
        slug,
        metadata,
        'document' as source_type
      FROM ${documents}
      WHERE ${sql.join(whereConditions, sql` AND `)}
    `;
  }

  private buildOrderClause(
    sortType?: string,
    sorter?: string,
  ): ReturnType<typeof sql.raw> | ReturnType<typeof sql> {
    const sortableFields: Record<string, string> = {
      createdAt: 'created_at',
      name: 'name',
      size: 'size',
      updatedAt: 'updated_at',
    };

    if (sorter && sortType && sorter in sortableFields) {
      const direction = sortType.toLowerCase() === SortType.Asc ? 'ASC' : 'DESC';
      return sql.raw(`${sortableFields[sorter]} ${direction}`);
    }

    return sql.raw('created_at DESC');
  }

  private getFileTypePrefix(category: FilesTabs): string | string[] {
    switch (category) {
      case FilesTabs.Audios: {
        return 'audio';
      }
      case FilesTabs.Documents: {
        return ['application', 'custom'];
      }
      case FilesTabs.Images: {
        return 'image';
      }
      case FilesTabs.Videos: {
        return 'video';
      }
      case FilesTabs.Websites: {
        return 'text/html';
      }
      default: {
        return '';
      }
    }
  }
}
