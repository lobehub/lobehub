import type { EnvironmentConfiguration } from '@lobechat/types';
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

/** One run of an environment, as the execution plane's trail records it. */
export interface SandboxSessionRecord {
  /** Set on builds: what the build status endpoint is polled with. */
  buildId: string | null;
  endedAt: string | null;
  /** Null while the run is still going. */
  endReason:
    | 'build_failed'
    | 'build_gone'
    | 'build_succeeded'
    | 'build_timeout'
    | 'expired'
    | 'explicit'
    | 'idle'
    | 'lost'
    | 'switched'
    | null;
  /** The instance id, which is what the snapshot is stored under. */
  environment: string | null;
  id: number;
  kind: 'build' | 'session';
  /** A console session opened by the file browser rather than a conversation. */
  management: boolean;
  sessionId: string;
  sessionUserId: string;
  /** Archive size after the teardown snapshot; null when it failed or has not run. */
  snapshotBytes: number | null;
  snapshotError: string | null;
  startedAt: string;
  topicId: string | null;
}

/**
 * Who holds which instance right now. Its own call rather than a field on the
 * environment listing: occupancy is a Redis read, while a listing reads the
 * volume, and a composer menu that only wants to mark a row "running" must not
 * be the reason a sandbox starts on a deployment without a files function.
 */
/** A build in flight, or the verdict on one that finished. */
export interface SandboxBuildStatus {
  buildId: string;
  /** Log since the requested offset; empty when nothing new has been written. */
  chunk: string;
  environment: string;
  /** The process's exit status once it has one; null while running. */
  exitCode: number | null;
  /** Where to resume the log from on the next poll. */
  logOffset: number;
  seconds: number;
  /**
   * Which revision of the specification the finished environment was built
   * from, read back from the manifest the runtime published. Null while
   * running and on a failure: nothing is published on that path, so there is
   * no revision to record.
   */
  specDigest: string | null;
  state: 'running' | 'succeeded' | 'failed';
}

export interface SandboxOccupancy {
  /** Held right now. An instance nobody holds is absent. */
  held: { name: string; own: boolean }[];
  /** The lease store did not answer, so `held` is empty for want of one. */
  unavailable: boolean;
}

export interface SandboxSessionList {
  /** Pass as `before` to fetch the next page; null on the last one. */
  nextBefore: string | null;
  sessions: SandboxSessionRecord[];
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
      const body = await response
        .json()
        .catch(() => ({}) as { error_description?: string; message?: string });
      log('workspace file request failed: %s %d %O', path, response.status, body);
      // The market answers in the OAuth shape — `error` for the code and
      // `error_description` for the reason — so reading `message` alone
      // reduced every refusal ("could not delete", "outside the workspace")
      // to the status number, which is the one thing the user cannot act on.
      throw new SandboxWorkspaceFilesError(
        body.error_description ||
          body.message ||
          `Workspace request failed with status ${response.status}`,
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
     * Re-measure the directory and return the workspace with the fresh figure.
     *
     * Separate from {@link getWorkspace}, which reads the stored number: this
     * one walks the volume, and it also stamps the workspace as active. So it
     * belongs on something the user asked for — a refresh button — and never
     * on a page load, where it would keep every workspace it displays
     * permanently young and hide the idle ones from any later sweep.
     */
    refreshUsage: async (params: RequestContext = {}): Promise<SandboxWorkspaceInfo> =>
      request(`${CURRENT_WORKSPACE}/usage`, {
        body: JSON.stringify({ topicId: params.topicId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),

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

    /**
     * One environment's run history, newest first. Answered from the control
     * plane's own trail, so unlike the listings above it needs no sandbox
     * session and costs no cold start.
     */
    listEnvironmentSessions: async (params: {
      before?: string;
      limit?: number;
      name: string;
    }): Promise<SandboxSessionList> => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set('limit', String(params.limit));
      if (params.before) query.set('before', params.before);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(
        `${CURRENT_WORKSPACE}/environments/${encodeURIComponent(params.name)}/sessions${suffix}`,
      );
    },

    /**
     * Which of `names` a running sandbox holds, and whether the holder is this
     * topic's own session. Control plane only — no sandbox, no volume.
     */
    readOccupancy: async (params: {
      names: string[];
      topicId?: string;
    }): Promise<SandboxOccupancy> => {
      const query = new URLSearchParams({ names: params.names.join(',') });
      if (params.topicId) query.set('topicId', params.topicId);

      return request(`${CURRENT_WORKSPACE}/environments/occupancy?${query.toString()}`);
    },

    /**
     * Start building an environment from its specification.
     *
     * Returns as soon as the build has started: a bootstrap running an install
     * is minutes long, so it is polled through {@link buildStatus} rather than
     * awaited. The specification carries NO credential — the execution plane
     * holds the GitHub connection and attaches one on the way past, so a token
     * never passes through here.
     */
    buildEnvironment: async (params: {
      name: string;
      specification: EnvironmentConfiguration;
      topicId?: string;
    }): Promise<{ buildId: string }> =>
      request(`${CURRENT_WORKSPACE}/environments/${encodeURIComponent(params.name)}/build`, {
        body: JSON.stringify({ specification: params.specification, topicId: params.topicId }),
        method: 'POST',
      }),

    /** Poll a build, pulling its log from `logOffset` on. */
    buildStatus: async (params: {
      buildId: string;
      logOffset?: number;
      name: string;
      topicId?: string;
    }): Promise<SandboxBuildStatus> => {
      const query = new URLSearchParams();
      if (params.logOffset !== undefined) query.set('logOffset', String(params.logOffset));
      if (params.topicId) query.set('topicId', params.topicId);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';

      return request(
        `${CURRENT_WORKSPACE}/environments/${encodeURIComponent(params.name)}` +
          `/build/${encodeURIComponent(params.buildId)}${suffix}`,
      );
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

    /**
     * Write a file, creating it and its parents when they do not exist.
     *
     * Text only: the endpoint carries `content` as a JSON string with no
     * encoding field, so there is no way to round-trip bytes through it. A
     * caller holding binary has to wait for an upload path rather than
     * smuggling it through as text.
     */
    writeFile: async (
      params: RequestContext & { content: string; path: string },
    ): Promise<{ path: string }> =>
      request(`${CURRENT_WORKSPACE}/file`, {
        body: JSON.stringify({
          content: params.content,
          path: params.path,
          topicId: params.topicId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      }),
  };
};

export type SandboxWorkspaceClient = ReturnType<typeof createSandboxWorkspaceClient>;
