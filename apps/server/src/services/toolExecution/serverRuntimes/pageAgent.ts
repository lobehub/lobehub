import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  PageAgentExecutionRuntime,
  type PageAgentRuntimeService,
} from '@lobechat/builtin-tool-page-agent/executionRuntime';
import { EditorRuntime } from '@lobechat/editor-runtime';

import { withHeadlessEditorLock } from '@/server/services/agentDocuments/headlessEditor';
import {
  createPageSessions,
  type PageSessions,
  type PageWriter,
} from '@/server/services/pageCollab';
import { runPageExclusive } from '@/server/services/pageCollab/queue';

import type { ServerRuntimeRegistration } from './types';

type EditorRuntimeEditorParam = Parameters<EditorRuntime['setEditor']>[0];

const buildService = (sessions: PageSessions): PageAgentRuntimeService => ({
  initPage: async (args, ctx) =>
    runPageExclusive(ctx.documentId!, () =>
      withHeadlessEditorLock(async () => {
        const session = await sessions.openSession(ctx.documentId!);
        try {
          const runtime = new EditorRuntime();
          runtime.setEditor(session.draft.editor.kernel as unknown as EditorRuntimeEditorParam);
          runtime.setCurrentDocId(ctx.documentId!);
          runtime.setTitleHandlers(session.setTitle, () => session.title);

          const { extractedTitle, nodeCount } = await runtime.initPage(args);
          await session.commit();

          return {
            content: extractedTitle
              ? `Page replaced with ${nodeCount} blocks; title set to "${extractedTitle}".`
              : `Page replaced with ${nodeCount} blocks.`,
            state: { changed: true, nodeCount, rootId: 'root' },
          };
        } finally {
          session.draft.destroy();
        }
      }),
    ),
});

export const pageAgentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Page Agent execution');
    }
    const writer: PageWriter = {
      agentId: context.agentId,
      operationId: context.rootOperationId ?? context.operationId,
      saveSource: 'llm_call',
      userId: context.userId,
      workspaceId: context.workspaceId,
      writeSource: 'agent',
    };
    return new PageAgentExecutionRuntime(
      buildService(createPageSessions(context.serverDB, writer)),
    );
  },
  identifier: PageAgentIdentifier,
};
