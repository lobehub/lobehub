import { and, eq, inArray } from 'drizzle-orm';

import { type Database, files, knowledgeBaseFiles } from './schema';

export class KnowledgeBaseModel {
  constructor(
    private db: Database,
    private userId: string,
  ) {}

  async addFiles(knowledgeBaseId: string, fileIds: string[]) {
    const ownedFiles = await this.db
      .select()
      .from(files)
      .where(and(eq(files.userId, this.userId), inArray(files.id, fileIds)));
    return (
      this.db
        .insert(knowledgeBaseFiles)
        // alint-expect
        .values(
          ownedFiles.map((file) => ({ fileId: file.id, knowledgeBaseId, userId: this.userId })),
        )
    );
  }
}
