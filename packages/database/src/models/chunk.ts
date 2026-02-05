import type { ChunkMetadata, FileChunk } from '@lobechat/types';
import { and, asc, cosineDistance, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chunk } from 'es-toolkit/compat';

import type { NewChunkItem, NewUnstructuredChunkItem } from '../schemas';
import { chunks, embeddings, fileChunks, files, unstructuredChunks } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class ChunkModel {
  private userId: string;

  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  bulkCreate = async (params: NewChunkItem[], fileId: string) => {
    return this.db.transaction(async (trx) => {
      if (params.length === 0) return [];

      const result = await trx.insert(chunks).values(params).returning();

      const fileChunksData = result.map((chunk) => ({
        chunkId: chunk.id,
        fileId,
        userId: this.userId,
      }));

      if (fileChunksData.length > 0) {
        await trx.insert(fileChunks).values(fileChunksData);
      }

      return result;
    });
  };

  bulkCreateUnstructuredChunks = async (params: NewUnstructuredChunkItem[]) => {
    return this.db.insert(unstructuredChunks).values(params);
  };

  delete = async (id: string) => {
    return this.db.delete(chunks).where(and(eq(chunks.id, id), eq(chunks.userId, this.userId)));
  };

  deleteOrphanChunks = async () => {
    const orphanedChunks = await this.db
      .select({ chunkId: chunks.id })
      .from(chunks)
      .leftJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(isNull(fileChunks.fileId));

    const ids = orphanedChunks.map((chunk) => chunk.chunkId);
    if (ids.length === 0) return;

    const list = chunk(ids, 500);

    await this.db.transaction(async (trx) => {
      await Promise.all(
        list.map(async (chunkIds) => {
          await trx.delete(chunks).where(inArray(chunks.id, chunkIds));
        }),
      );
    });
  };

  findById = async (id: string) => {
    return this.db.query.chunks.findFirst({
      where: and(eq(chunks.id, id)),
    });
  };

  findByFileId = async (id: string, page = 0) => {
    const data = await this.db
      .select({
        abstract: chunks.abstract,
        createdAt: chunks.createdAt,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        text: chunks.text,
        type: chunks.type,
        updatedAt: chunks.updatedAt,
      })
      .from(chunks)
      .innerJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(and(eq(fileChunks.fileId, id), eq(chunks.userId, this.userId)))
      .limit(20)
      .offset(page * 20)
      .orderBy(asc(chunks.index));

    return data.map((item) => {
      const metadata = item.metadata as ChunkMetadata;

      return { ...item, metadata, pageNumber: metadata?.pageNumber } as FileChunk;
    });
  };

  getChunksTextByFileId = async (id: string): Promise<{ id: string; text: string }[]> => {
    const data = await this.db
      .select()
      .from(chunks)
      .innerJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .where(eq(fileChunks.fileId, id));

    return data
      .map((item) => item.chunks)
      .map((chunk) => ({ id: chunk.id, text: this.mapChunkText(chunk) }))
      .filter((chunk) => chunk.text) as { id: string; text: string }[];
  };

  countByFileIds = async (ids: string[]) => {
    if (ids.length === 0) return [];

    return this.db
      .select({
        count: count(fileChunks.chunkId),
        id: fileChunks.fileId,
      })
      .from(fileChunks)
      .where(inArray(fileChunks.fileId, ids))
      .groupBy(fileChunks.fileId);
  };

  countByFileId = async (ids: string) => {
    const data = await this.db
      .select({
        count: count(fileChunks.chunkId),
        id: fileChunks.fileId,
      })
      .from(fileChunks)
      .where(eq(fileChunks.fileId, ids))
      .groupBy(fileChunks.fileId);

    return data[0]?.count ?? 0;
  };

  semanticSearch = async ({
    embedding,
    fileIds,
  }: {
    embedding: number[];
    fileIds: string[] | undefined;
    query: string;
  }) => {
    const similarity = sql<number>`1 - (${cosineDistance(embeddings.embeddings, embedding)})`;

    const data = await this.db
      .select({
        fileId: fileChunks.fileId,
        fileName: files.name,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        similarity,
        text: chunks.text,
        type: chunks.type,
      })
      .from(chunks)
      .leftJoin(embeddings, eq(chunks.id, embeddings.chunkId))
      .leftJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .leftJoin(files, eq(fileChunks.fileId, files.id))
      .where(fileIds ? inArray(fileChunks.fileId, fileIds) : undefined)
      .orderBy((t) => desc(t.similarity))
      .limit(30);

    return data.map((item) => ({
      ...item,
      metadata: item.metadata as ChunkMetadata,
    }));
  };

  semanticSearchForChat = async ({
    embedding,
    fileIds,
    topK = 15,
  }: {
    embedding: number[];
    fileIds: string[] | undefined;
    query: string;
    topK?: number;
  }) => {
    const similarity = sql<number>`1 - (${cosineDistance(embeddings.embeddings, embedding)})`;

    const hasFiles = fileIds && fileIds.length > 0;

    if (!hasFiles) return [];

    const result = await this.db
      .select({
        fileId: files.id,
        fileName: files.name,
        id: chunks.id,
        index: chunks.index,
        metadata: chunks.metadata,
        similarity,
        text: chunks.text,
        type: chunks.type,
      })
      .from(chunks)
      .leftJoin(embeddings, eq(chunks.id, embeddings.chunkId))
      .leftJoin(fileChunks, eq(chunks.id, fileChunks.chunkId))
      .leftJoin(files, eq(files.id, fileChunks.fileId))
      .where(inArray(fileChunks.fileId, fileIds))
      .orderBy((t) => desc(t.similarity))
      // Relaxed to 15 for now
      .limit(topK);

    return result.map((item) => {
      return {
        fileId: item.fileId,
        fileName: item.fileName,
        id: item.id,
        index: item.index,
        similarity: item.similarity,
        text: this.mapChunkText(item),
      };
    });
  };

  private mapChunkText = (chunk: { metadata: any; text: string | null; type: string | null }) => {
    let text = chunk.text;

    if (chunk.type === 'Table') {
      text = `${chunk.text}

content in Table html is below:
${(chunk.metadata as ChunkMetadata).text_as_html}
`;
    }

    return text;
  };
}
