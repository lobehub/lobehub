import { toRecord } from '@lobechat/utils/object';

import { ConnectorDataError, getConnectorErrorMessage } from './errors';
import { createRecoverableMemo } from './memo';
import type { ConnectorDataProvider } from './providers';
import { withConnectorRetry } from './retry';

const MAX_TOOL_VERSION_LENGTH = 64;
const SAFE_TOOL_VERSION = /^[a-z0-9][\w.-]*$/i;
const MAX_WRAPPER_DEPTH = 3;

/** Minimal Composio tools client needed by read-only Composio connectors. */
export interface ComposioTools {
  /** Executes a version-pinned Composio tool for one connected account. */
  execute: (
    toolSlug: string,
    input: {
      arguments: Record<string, unknown>;
      connectedAccountId: string;
      userId: string;
      version: string;
    },
  ) => Promise<unknown>;
  /** Resolves raw tool metadata when no explicit version was injected. */
  getRawComposioToolBySlug?: (toolSlug: string) => Promise<unknown>;
}

/** Minimal Composio client accepted by Composio-backed connector clients. */
export interface ComposioClient {
  tools: ComposioTools;
}

/** Options shared by Composio-backed connector clients. */
export interface ComposioConnectorOptions {
  /** Composio SDK client used for version discovery and tool execution. */
  composio: ComposioClient;
  /** Connected account authorized for the target workspace. */
  connectedAccountId: string;
  /** Optional pinned toolkit version, primarily useful in deterministic tests. */
  toolVersion?: string;
  /** Composio entity that owns the connected account. */
  userId: string;
}

/** Accepts only explicit, safe tool versions; `latest` would make results drift. */
export const readComposioToolVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;
  if (
    value.length > MAX_TOOL_VERSION_LENGTH ||
    !SAFE_TOOL_VERSION.test(value) ||
    value.toLowerCase() === 'latest'
  ) {
    return;
  }
  return value;
};

/**
 * Reads `key` from a Composio tool result. Toolkits wrap their payload in zero
 * to a few `data` layers (Jira projects come back as `data.data.values`, issue
 * search as `data.issues`), so the known wrapper is followed a bounded number
 * of times.
 */
export const readComposioField = (value: unknown, key: string): unknown => {
  let current = toRecord(value);
  for (let depth = 0; current && depth <= MAX_WRAPPER_DEPTH; depth += 1) {
    if (key in current) return current[key];
    current = toRecord(current.data);
  }
  return undefined;
};

/**
 * Creates a tool runner for one connected account: resolves each tool's pinned
 * version once, executes with retry, and turns an unsuccessful result into a
 * connector error carrying the provider's message.
 *
 * Returns:
 * - `run(toolSlug, operation, arguments)` resolving to the tool's `data` payload
 */
export const createComposioToolRunner = (
  provider: ConnectorDataProvider,
  { composio, connectedAccountId, toolVersion, userId }: ComposioConnectorOptions,
) => {
  const toolVersions = new Map<string, () => Promise<string>>();
  const getToolVersion = (toolSlug: string) => {
    const existing = toolVersions.get(toolSlug);
    if (existing) return existing();
    const resolver = createRecoverableMemo(async () => {
      const configured = readComposioToolVersion(toolVersion);
      if (configured) return configured;
      const tool = await composio.tools.getRawComposioToolBySlug?.(toolSlug);
      const discovered = readComposioToolVersion(toRecord(tool)?.version);
      if (discovered) return discovered;
      throw new ConnectorDataError({
        cause: tool,
        code: `${provider}_tool_version_unavailable`,
        operation: 'resolveToolVersion',
        provider,
        retryable: false,
      });
    });
    toolVersions.set(toolSlug, resolver);
    return resolver();
  };

  return (toolSlug: string, operation: string, arguments_: Record<string, unknown>) =>
    withConnectorRetry(async () => {
      const response = toRecord(
        await composio.tools.execute(toolSlug, {
          arguments: arguments_,
          connectedAccountId,
          userId,
          version: await getToolVersion(toolSlug),
        }),
      );
      if (response?.successful !== true) {
        throw new ConnectorDataError({
          cause: response,
          code: `${provider}_${operation}_failed`,
          message: getConnectorErrorMessage(response?.error) ?? getConnectorErrorMessage(response),
          operation,
          provider,
          retryable: false,
        });
      }
      return response.data;
    });
};
