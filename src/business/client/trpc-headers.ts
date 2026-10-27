/**
 * OSS builds have no workspace layer: the hosted build replaces this module
 * with one that reads the active workspace from the session. Set
 * `NEXT_PUBLIC_DEMO_WORKSPACE_ID` to preview workspace-scoped surfaces locally.
 */
const demoWorkspaceId = process.env.NEXT_PUBLIC_DEMO_WORKSPACE_ID;

export const getBusinessTrpcHeaders = async (): Promise<Record<string, string>> =>
  demoWorkspaceId ? { 'X-Workspace-Id': demoWorkspaceId } : {};
