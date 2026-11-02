import { CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import type { IBuiltinToolExecutor, ToolHookContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useChatStore } from '@/store/chat';
import { useDocumentStore } from '@/store/document';

/**
 * Tool calls that edit the open page through the server's page sync. Shell
 * calls write back only in the foreground (background runs never sync).
 */
const PAGE_EDIT_APIS: Record<string, readonly string[]> = {
  [CloudSandboxIdentifier]: ['execScript', 'runCommand'],
  [PageAgentIdentifier]: ['initPage'],
  [SkillsIdentifier]: ['execScript', 'runCommand'],
};

/**
 * The page a tool call edits when that page has no collaboration room: the
 * document of the page-scoped run on the call's topic. Room pages merge the
 * agent's edits live and need none of this.
 */
const resolveStoredPageEdit = ({ apiName, identifier, params, topicId }: ToolHookContext) => {
  if (!topicId || !PAGE_EDIT_APIS[identifier]?.includes(apiName)) return;
  if ((params as { background?: unknown } | undefined)?.background) return;

  const run = Object.values(useChatStore.getState().operations).find(
    (op) =>
      op.context.scope === 'page' && op.context.topicId === topicId && !!op.context.documentId,
  );
  const documentId = run?.context.documentId;
  if (!documentId) return;

  const doc = useDocumentStore.getState().documents[documentId];
  if (!doc || doc.collab) return;
  return documentId;
};

/**
 * Holds the stored page read-only while the agent's command edits it, then
 * reloads it (body, title, page list) so the editor shows what it wrote.
 */
const pageEditHooks = {
  onAfterCall: async (ctx: ToolHookContext) => {
    const documentId = resolveStoredPageEdit(ctx);
    if (!documentId) return;

    useDocumentStore.getState().endAgentEdit(documentId);
    await invalidateDocumentMutation({ cause: 'document-service', documentId });
  },
  onBeforeCall: (ctx: ToolHookContext) => {
    const documentId = resolveStoredPageEdit(ctx);
    if (documentId) useDocumentStore.getState().beginAgentEdit(documentId);
  },
};

/** Adds the page-edit hooks to an executor, keeping any hooks it already has. */
export const withPageEditHooks = <T extends IBuiltinToolExecutor>(
  executor: T,
): IBuiltinToolExecutor => ({
  getApiNames: executor.getApiNames.bind(executor),
  hasApi: executor.hasApi.bind(executor),
  identifier: executor.identifier,
  invoke: executor.invoke.bind(executor),
  onAfterCall: async (ctx) => {
    await pageEditHooks.onAfterCall(ctx);
    await executor.onAfterCall?.(ctx);
  },
  onBeforeCall: async (ctx) => {
    pageEditHooks.onBeforeCall(ctx);
    await executor.onBeforeCall?.(ctx);
  },
});

const EMPTY_API_ENUM = {} as Record<string, string>;

/**
 * Hook-only executor for the page agent, whose tools run only on the server:
 * no APIs, so it is never invoked; it exists for the `tool_start` / `tool_end`
 * dispatchers, which resolve hooks by identifier.
 */
class PageAgentHookExecutor extends BaseExecutor<typeof EMPTY_API_ENUM> {
  readonly identifier = PageAgentIdentifier;
  protected readonly apiEnum = EMPTY_API_ENUM;

  onAfterCall = pageEditHooks.onAfterCall;
  onBeforeCall = pageEditHooks.onBeforeCall;
}

export const pageAgentHookExecutor = new PageAgentHookExecutor();
