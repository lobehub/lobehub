import type { ISandboxService } from '@lobechat/builtin-tool-cloud-sandbox';

import type { ToolExecutionContext } from '../types';

export type SandboxWrapper = (service: ISandboxService) => ISandboxService;

export const pageSandboxWrapper = (context: ToolExecutionContext): SandboxWrapper | undefined => {
  const { documentId, scope, serverDB, userId, workspaceId } = context;
  if (scope !== 'page' || !documentId || !serverDB || !userId) return undefined;

  return (service) => {
    // The page sync pulls in the headless editor; load it only for page runs.
    let synced: Promise<ISandboxService> | undefined;
    const load = () =>
      (synced ??= Promise.all([
        import('@/server/services/pageCollab'),
        import('@/server/services/pageCollab/sandboxSync'),
      ]).then(([{ PageCollabService }, { withPageSync }]) =>
        withPageSync(service, {
          collab: new PageCollabService(serverDB, userId, workspaceId),
          documentId,
        }),
      ));

    return {
      callTool: async (toolName, params) => (await load()).callTool(toolName, params),
      exportAndUploadFile: (path, filename, options) =>
        service.exportAndUploadFile(path, filename, options),
    };
  };
};
