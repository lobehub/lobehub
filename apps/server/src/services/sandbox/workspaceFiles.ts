import debug from 'debug';

const log = debug('lobe-server:sandbox:workspace-files');

/**
 * Client for the execution plane's persistent-workspace file API.
 *
 * Hand-written rather than taken from the market SDK, which does not carry
 * these endpoints yet. It is deliberately small and replaceable: same paths,
 * same shapes, so swapping it for the generated client later is a deletion.
 *
 * Every `path` is RELATIVE to the workspace root (`reports/q3.md`). The
 * absolute mount path never crosses this boundary — which keeps the mount
 * layout an implementation detail and makes the server-side fence unambiguous,
 * since there is no absolute path for a caller to smuggle in.
 */
export interface SandboxWorkspaceFileEntry {
  isDirectory: boolean;
  modifiedAt?: string;
  name: string;
  /** Relative to the workspace root. */
  path: string;
  size?: number;
}

export interface SandboxWorkspaceFileList {
  entries: SandboxWorkspaceFileEntry[];
  path: string;
  /** True when the listing hit the server-side entry cap. */
  truncated: boolean;
}

export interface SandboxWorkspaceInfo {
  dir: string;
  key: string;
  lastActiveAt: string | null;
  /**
   * Outcome of the most recent environment snapshot. Snapshots happen when a
   * session is torn down, with no request left to fail, so this is the only
   * place a user can learn their environments stopped being saved.
   */
  lastSnapshotAt: string | null;
  lastSnapshotError: string | null;
  quotaBytes: number;
  status: 'active' | 'archived';
  usageBytes: number | null;
  usageCheckedAt: string | null;
}

/**
 * A snapshot the execution plane holds. Only environments that have actually
 * been captured appear — one created but never used has metadata here and no
 * snapshot there, which is why the two are joined rather than assumed to match.
 */
export interface SandboxEnvironmentSnapshot {
  /** Size of the snapshot archive itself; exact, not a directory walk. */
  bytes: number;
  /** Files in the archive, or `null` when the sidecar metadata disagrees with it. */
  files: number | null;
  /** The identifier, which is this platform's environment id. */
  name: string;
  updatedAt: string;
}

export interface SandboxWorkspaceClientOptions {
  baseURL: string;
  headers: Record<string, string>;
}

interface RequestContext {
  /**
   * Topic whose warm sandbox session should serve the call. The volume is
   * mounted into the sandbox, not into the market service, so every file
   * operation runs inside a session; reusing the one the user is already
   * working in avoids cold-starting a second sandbox just to list a directory.
   */
  topicId?: string;
}

/**
 * `current` resolves to whatever workspace the caller's signed entitlement
 * names. Sending a literal key would be the only way for a caller to ask for
 * someone else's directory, so we never do.
 */
const CURRENT_WORKSPACE = 'current';

export class SandboxWorkspaceFilesError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SandboxWorkspaceFilesError';
    this.status = status;
  }
}

export const createSandboxWorkspaceClient = ({
  baseURL,
  headers,
}: SandboxWorkspaceClientOptions) => {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseURL}/api/v1/sandbox/workspaces/${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { message?: string });
      log('workspace file request failed: %s %d %O', path, response.status, body);
      throw new SandboxWorkspaceFilesError(
        body.message || `Workspace request failed with status ${response.status}`,
        response.status,
      );
    }

    const payload = (await response.json()) as { data: T };
    return payload.data;
  };

  const withTopic = (query: URLSearchParams, { topicId }: RequestContext) => {
    if (topicId) query.set('topicId', topicId);
    return query;
  };

  return {
    /**
     * Create a directory, parents included. Idempotent — an existing directory
     * is a success, so a picker can offer "new folder" without first proving
     * the name is free.
     */
    createDirectory: async (params: RequestContext & { path: string }): Promise<{ path: string }> =>
      request(`${CURRENT_WORKSPACE}/directory`, {
        body: JSON.stringify({ path: params.path, topicId: params.topicId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),

    copyEnvironment: async (
      params: RequestContext & { from: string; to: string },
    ): Promise<{ name: string }> =>
      request(`${CURRENT_WORKSPACE}/environments/${encodeURIComponent(params.from)}/copy`, {
        body: JSON.stringify({ to: params.to, topicId: params.topicId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),

    deleteEnvironment: async (
      params: RequestContext & { name: string },
    ): Promise<{ name: string }> => {
      const query = withTopic(new URLSearchParams(), params);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(
        `${CURRENT_WORKSPACE}/environments/${encodeURIComponent(params.name)}${suffix}`,
        { method: 'DELETE' },
      );
    },

    deleteFile: async (
      params: RequestContext & { path: string; recursive?: boolean },
    ): Promise<{ path: string }> => {
      const query = withTopic(new URLSearchParams({ path: params.path }), params);
      if (params.recursive) query.set('recursive', 'true');

      return request(`${CURRENT_WORKSPACE}/file?${query.toString()}`, { method: 'DELETE' });
    },

    getWorkspace: async (params: RequestContext = {}): Promise<SandboxWorkspaceInfo> => {
      const query = withTopic(new URLSearchParams(), params);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(`${CURRENT_WORKSPACE}${suffix}`);
    },

    /**
     * Needs a live sandbox session, so it can take seconds on a cold start —
     * a caller rendering this must show it is loading rather than treat it as
     * data it already has.
     */
    listEnvironments: async (
      params: RequestContext = {},
    ): Promise<{ environments: SandboxEnvironmentSnapshot[] }> => {
      const query = withTopic(new URLSearchParams(), params);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(`${CURRENT_WORKSPACE}/environments${suffix}`);
    },

    listFiles: async (
      params: RequestContext & { path?: string; recursive?: boolean } = {},
    ): Promise<SandboxWorkspaceFileList> => {
      const query = withTopic(new URLSearchParams(), params);
      if (params.path) query.set('path', params.path);
      if (params.recursive) query.set('recursive', 'true');
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(`${CURRENT_WORKSPACE}/files${suffix}`);
    },

    readFile: async (
      params: RequestContext & { path: string },
    ): Promise<{ content: string; mimeType?: string; path: string }> => {
      const query = withTopic(new URLSearchParams({ path: params.path }), params);

      return request(`${CURRENT_WORKSPACE}/file?${query.toString()}`);
    },
  };
};

export type SandboxWorkspaceClient = ReturnType<typeof createSandboxWorkspaceClient>;
