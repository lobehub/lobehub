import { isManagedCloudDevice } from '@lobechat/types';

export interface RequesterCredentialDeviceRow {
  identitySource?: string | null;
  sharedFromDeviceId?: string | null;
  visibility?: string | null;
  workspaceId?: string | null;
}

export const isRequesterCredentialDevice = (row: RequesterCredentialDeviceRow): boolean =>
  !!row.workspaceId &&
  row.visibility === 'public' &&
  !row.sharedFromDeviceId &&
  !isManagedCloudDevice({ identitySource: row.identitySource ?? undefined });
