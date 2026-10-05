import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import {
  PageAgentExecutionRuntime,
  type PageAgentRuntimeService,
} from '@lobechat/builtin-tool-page-agent/executionRuntime';
import { EditorRuntime } from '@lobechat/editor-runtime';

import { type LobeChatDatabase } from '@/database/type';
import { PageCollabService } from '@/server/services/pageCollab';

import type { ServerRuntimeRegistration } from './types';

type EditorRuntimeEditorParam = Parameters<EditorRuntime['setEditor']>[0];

const buildService = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): PageAgentRuntimeService => {
  const collab = new PageCollabService(db, userId, workspaceId);

  return {
    initPage: async (args, ctx) => {
      const session = await collab.openSession(ctx.documentId!);
      try {
        const runtime = new EditorRuntime();
        runtime.setEditor(session.fork.editor.kernel as unknown as EditorRuntimeEditorParam);
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
        session.fork.destroy();
      }
    },
  };
};

export const pageAgentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Page Agent execution');
    }
    return new PageAgentExecutionRuntime(
      buildService(context.serverDB, context.userId, context.workspaceId),
    );
  },
  identifier: PageAgentIdentifier,
};
