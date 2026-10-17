import { def } from './defineKey';

// Persisted in the local tier (sync first paint) so a gated config page can
// open from the last confirmed access while it revalidates. The server still
// enforces every write; the client only uses this to decide what to render.
export const resourcePermissionKeys = {
  generalAccess: def(
    'resourcePermission:generalAccess',
    (resourceType: string, resourceId: string) => [
      'resourcePermission:generalAccess',
      resourceType,
      resourceId,
    ],
  ),
};
