import type { DocumentRecord } from '@lobechat/builtin-tool-personal-pages';
import { PersonalPagesIdentifier } from '@lobechat/builtin-tool-personal-pages';
import { PersonalPagesExecutionRuntime } from '@lobechat/builtin-tool-personal-pages/executionRuntime';

import { PersonalPagesService } from '@/server/services/personalPages';
import { toDocumentRecord } from '@/services/personalPages/toDocumentRecord';

import { type ServerRuntimeRegistration } from './types';

export const personalPagesRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Personal Pages execution');
    }

    const service = new PersonalPagesService(context.serverDB, context.userId);

    return new PersonalPagesExecutionRuntime({
      createDocument: async ({ content, title }): Promise<DocumentRecord | undefined> => {
        const doc = await service.createPage(title, content);
        return { content: doc.content ?? undefined, id: doc.id, title: doc.title ?? undefined };
      },
      listDocuments: async (): Promise<DocumentRecord[]> => {
        const docs = await service.listPages();
        return docs.map((d) => ({
          content: d.content ?? undefined,
          filename: d.filename ?? undefined,
          id: d.id,
          title: d.title ?? undefined,
        }));
      },
      modifyNodes: async ({ id, operations }) =>
        toDocumentRecord(await service.modifyNodes(id, operations)),
      readDocument: async ({ format, id }) =>
        toDocumentRecord(await service.readPage(id, { format })),
      replaceContent: async ({ content, id }) =>
        toDocumentRecord(await service.replaceContent(id, content)),
    });
  },
  identifier: PersonalPagesIdentifier,
};
