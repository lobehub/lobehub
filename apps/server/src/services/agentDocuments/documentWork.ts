import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';

import { WorkModel } from '@/database/models/work';
import { WorkspaceModel } from '@/database/models/workspace';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

const getAgentDocumentAppUrl = (): string | undefined => {
  try {
    return appEnv.APP_URL;
  } catch {
    return process.env.APP_URL;
  }
};

/**
 * Shared best-effort agent-document Work helpers for the server tool runtime
 * and the lambda `agentDocument` router: document URL building (used when the
 * server runtime registers Work) and Work deletion (used by the lambda's
 * removeDocument mutation). Registration itself now lives with each caller —
 * the server runtime writes Work with cost inline, and the legacy client
 * runtime stashes an intent that `call_tool` writes once — so this registrar no
 * longer owns a `registerDocumentWork`. Failures are swallowed on purpose: Work
 * bookkeeping must never fail the document operation itself.
 *
 * The workspace slug lookup for URL building is memoized per registrar
 * instance, so create one registrar per runtime/request and reuse it.
 */
export const createDocumentWorkRegistrar = (deps: {
  db: LobeChatDatabase;
  /** Log prefix identifying the call site, e.g. '[agentDocumentsRuntime]'. */
  logPrefix: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  const workModel = new WorkModel(deps.db, deps.userId, deps.workspaceId ?? undefined);
  let workspaceSlugPromise: Promise<string | undefined> | undefined;

  const resolveWorkspaceSlugForUrl = async (): Promise<string | undefined> => {
    if (!deps.workspaceId) return undefined;

    workspaceSlugPromise ??= new WorkspaceModel(deps.db, deps.userId)
      .findById(deps.workspaceId)
      .then((workspace) => workspace?.slug)
      .catch((error) => {
        console.error(
          `${deps.logPrefix} Failed to resolve workspace slug:`,
          { userId: deps.userId, workspaceId: deps.workspaceId },
          error,
        );
        return undefined;
      });

    return workspaceSlugPromise;
  };

  const buildRegisteredDocumentUrl = async (agentId: string, documentId?: string | null) => {
    if (!documentId) return undefined;
    const workspaceSlug = await resolveWorkspaceSlugForUrl();
    if (deps.workspaceId && !workspaceSlug) return undefined;

    return buildAgentDocumentUrl(getAgentDocumentAppUrl(), agentId, documentId, {
      workspaceSlug,
    });
  };

  const deleteDocumentWork = async (input: {
    agentDocumentId?: string | null;
    agentId: string;
    documentId?: string | null;
  }) => {
    if (!input.documentId) return;

    try {
      await workModel.deleteDocumentWork({
        agentDocumentId: input.agentDocumentId,
        agentId: input.agentId,
        documentId: input.documentId,
      });
    } catch (error) {
      console.error(
        `${deps.logPrefix} delete document work failed:`,
        {
          agentDocumentId: input.agentDocumentId,
          documentId: input.documentId,
        },
        error,
      );
    }
  };

  return { buildRegisteredDocumentUrl, deleteDocumentWork };
};

export type DocumentWorkRegistrar = ReturnType<typeof createDocumentWorkRegistrar>;
