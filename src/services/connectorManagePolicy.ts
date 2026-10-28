import { type WorkspaceConnectorMemberManage } from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

/** Workspace-dimensioned by `useClientDataSWR`, so each workspace keeps its own entry. */
export const CONNECTOR_MANAGE_POLICY_SWR_KEY = 'connector/managePolicy';

export interface ConnectorManagePolicy {
  /** Owners and admins choose whether members may maintain shared connectors. */
  canEditPolicy: boolean;
  /** Whether the viewer may connect, re-authorize, sync or remove shared connectors. */
  canManage: boolean;
  memberManage: WorkspaceConnectorMemberManage;
}

export const getConnectorManagePolicy = (): Promise<ConnectorManagePolicy> =>
  lambdaClient.connector.getManagePolicy.query();

/** Refetch the policy, e.g. after a 403 shows the cached one is stale. */
export const refreshConnectorManagePolicy = () =>
  mutate((key: unknown) => Array.isArray(key) && key[0] === CONNECTOR_MANAGE_POLICY_SWR_KEY);

export const updateConnectorManagePolicy = async (memberManage: WorkspaceConnectorMemberManage) => {
  await lambdaClient.connector.updateManagePolicy.mutate({ memberManage });
  await refreshConnectorManagePolicy();
};
