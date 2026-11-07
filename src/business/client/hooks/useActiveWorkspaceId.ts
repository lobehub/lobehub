/**
 * OSS builds ship without the workspace layer (the hosted build replaces this
 * module). A local preview of a workspace-only surface — such as the PageEditor
 * review panel — can opt in explicitly with `NEXT_PUBLIC_DEMO_WORKSPACE_ID`;
 * without it every caller keeps seeing `null`, as before.
 */
const demoWorkspaceId = process.env.NEXT_PUBLIC_DEMO_WORKSPACE_ID || null;

export const getActiveWorkspaceId = (): string | null => demoWorkspaceId;

export const useActiveWorkspaceId = (): string | null => demoWorkspaceId;
