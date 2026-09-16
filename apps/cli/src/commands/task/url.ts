import { taskTitleSlug } from '@lobechat/utils/taskSlug';

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

/**
 * `name` only adds the readable slug tail (`/task/T-501/ship-the-thing`); the
 * identifier alone still resolves the task, so omitting it stays valid.
 */
export const buildTaskUrl = ({
  identifier,
  name,
  serverUrl,
  workspaceSlug,
}: Omit<AppUrlOptions, 'pathname'> & { identifier: string; name?: string | null }) => {
  const slug = taskTitleSlug(name);

  return buildAppUrl({
    pathname: `/task/${encodeURIComponent(identifier)}${slug ? `/${slug}` : ''}`,
    serverUrl,
    workspaceSlug,
  });
};

export const resolveAppUrlBuilder = async (client: TrpcClient) => {
  const workspace = resolveWorkspaceId() ? await client.workspace.getById.query() : null;

  return (pathname: string) =>
    buildAppUrl({ pathname, serverUrl: resolveServerUrl(), workspaceSlug: workspace?.slug });
};

export const resolveAppUrl = async (client: TrpcClient, pathname: string) =>
  (await resolveAppUrlBuilder(client))(pathname);
