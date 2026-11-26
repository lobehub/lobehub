import type { ReadCardDocsParams, RenderUIParams } from '@lobechat/builtin-tool-a2ui';

import { lambdaClient } from '@/libs/trpc/client';

/** The card tool, run on the server for a client-executed Agent run. */
class A2uiService {
  readCardDocs = (params: ReadCardDocsParams) => lambdaClient.a2ui.readCardDocs.query(params);

  renderUI = (params: RenderUIParams) =>
    lambdaClient.a2ui.renderUI.mutate({ operations: params.operations });
}

export const a2uiService = new A2uiService();
