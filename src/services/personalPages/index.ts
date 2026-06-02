import type { DocumentItem } from '@lobechat/database/schemas';

import { lambdaClient } from '@/libs/trpc/client';
import type { AgentDocumentLiteXMLOperation } from '@/server/services/document/headlessEditor';
import type { PersonalPageSnapshot } from '@/server/services/personalPages';

export type { PersonalPageSnapshot };

export class PersonalPagesService {
  async createPage(title: string, content: string = ''): Promise<DocumentItem> {
    return lambdaClient.personalPages.createPage.mutate({ content, title });
  }

  async readPage(
    id: string,
    format?: 'both' | 'markdown' | 'xml',
  ): Promise<PersonalPageSnapshot | undefined> {
    return lambdaClient.personalPages.readPage.query({ format, id });
  }

  async replaceContent(id: string, content: string): Promise<PersonalPageSnapshot | undefined> {
    return lambdaClient.personalPages.replaceContent.mutate({ content, id });
  }

  async modifyNodes(
    id: string,
    operations: AgentDocumentLiteXMLOperation[],
  ): Promise<PersonalPageSnapshot | undefined> {
    return lambdaClient.personalPages.modifyNodes.mutate({ id, operations });
  }

  async listPages(): Promise<DocumentItem[]> {
    return lambdaClient.personalPages.listPages.query();
  }
}

export const personalPagesService = new PersonalPagesService();
