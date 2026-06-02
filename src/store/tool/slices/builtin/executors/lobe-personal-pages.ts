import type { DocumentRecord } from '@lobechat/builtin-tool-personal-pages';
import { PersonalPagesExecutionRuntime } from '@lobechat/builtin-tool-personal-pages/executionRuntime';
import { PersonalPagesExecutor } from '@lobechat/builtin-tool-personal-pages/executor';

import { personalPagesService } from '@/services/personalPages';
import { toDocumentRecord } from '@/services/personalPages/toDocumentRecord';

const runtime = new PersonalPagesExecutionRuntime({
  createDocument: async ({ content, title }): Promise<DocumentRecord | undefined> => {
    const doc = await personalPagesService.createPage(title, content);
    return { content: doc.content ?? undefined, id: doc.id, title: doc.title ?? undefined };
  },
  listDocuments: async (): Promise<DocumentRecord[]> => {
    const docs = await personalPagesService.listPages();
    return docs.map((d) => ({
      content: d.content ?? undefined,
      filename: d.filename ?? undefined,
      id: d.id,
      title: d.title ?? undefined,
    }));
  },
  modifyNodes: async ({ id, operations }) =>
    toDocumentRecord(await personalPagesService.modifyNodes(id, operations)),
  readDocument: async ({ format, id }) =>
    toDocumentRecord(await personalPagesService.readPage(id, format)),
  replaceContent: async ({ content, id }) =>
    toDocumentRecord(await personalPagesService.replaceContent(id, content)),
});

export const personalPagesExecutor = new PersonalPagesExecutor(runtime);
