import type { TrpcClient } from '../../api/client';
import { resolveWorkspaceId } from '../../api/workspace';
import { resolveServerUrl } from '../../settings';

interface AppUrlOptions {
  pathname: string;
  serverUrl: string;
  workspaceSlug?: string;
}

export const buildAppUrl = ({ pathname, serverUrl, workspaceSlug }: AppUrlOptions) => {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const path = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}${normalizedPath}`
    : normalizedPath;

  return new URL(path, `${serverUrl}/`).toString();
};

export const buildTaskUrl = ({
  identifier,
  serverUrl,
  workspaceSlug,
}: Omit<AppUrlOptions, 'pathname'> & { identifier: string }) =>
  buildAppUrl({
    pathname: `/task/${encodeURIComponent(identifier)}`,
    serverUrl,
    workspaceSlug,
  });

export const resolveAppUrlBuilder = async (client: TrpcClient) => {
  const workspace = resolveWorkspaceId() ? await client.workspace.getById.query() : null;

  return (pathname: string) =>
    buildAppUrl({ pathname, serverUrl: resolveServerUrl(), workspaceSlug: workspace?.slug });
};

export const resolveAppUrl = async (client: TrpcClient, pathname: string) =>
  (await resolveAppUrlBuilder(client))(pathname);
