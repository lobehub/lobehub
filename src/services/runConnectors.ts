import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/** A conversation: the agent it runs and its topic. */
export interface RunConnectorsTarget {
  agentId?: string;
  topicId?: string;
}

/** A row the server lists for a conversation's run, with its tool prefix. */
export type RunConnectorRow = ConnectorWithTools & { toolIdentifier: string };

/** How long a send waits for the list before falling back to the local one. */
const REFRESH_TIMEOUT_MS = 3000;

const cache = new Map<string, RunConnectorRow[]>();
const inflight = new Map<string, Promise<RunConnectorRow[] | undefined>>();

const keyOf = ({ agentId, topicId }: RunConnectorsTarget) => `${agentId ?? ''}|${topicId ?? ''}`;

/**
 * The connector rows the server last listed for this conversation
 * (`connector.listForRun`), or undefined before any listing. Only the server
 * can tell whether a conversation may run the caller's own connections — a
 * private agent's own direct topic, not a group, channel, link-shared or
 * another agent's one — and only it holds their personal rows; a client-run
 * chat builds its connector tool sets from this list.
 */
export const getRunConnectors = (target: RunConnectorsTarget): RunConnectorRow[] | undefined =>
  cache.get(keyOf(target));

/** Every row any listed conversation runs: tool calls resolve by their prefix. */
export const getAllRunConnectors = (): RunConnectorRow[] => [...cache.values()].flat();

/**
 * List the conversation's connector rows again before a send. Waits at most
 * {@link REFRESH_TIMEOUT_MS}; on a timeout or failure the last listing (or
 * nothing) stands and the caller falls back to its local lists.
 */
export const refreshRunConnectors = async (
  target: RunConnectorsTarget,
  { timeoutMs = REFRESH_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<RunConnectorRow[] | undefined> => {
  if (!target.agentId) return undefined;
  // Outside a workspace nothing is private or carried over: the local lists
  // hold every row a run may use, split the way the server splits them
  const { getActiveWorkspaceId } = await import('@/business/client/hooks/useActiveWorkspaceId');
  if (!getActiveWorkspaceId()) return undefined;
  const key = keyOf(target);
  let request = inflight.get(key);
  if (!request) {
    request = (async () => {
      try {
        const { lambdaClient } = await import('@/libs/trpc/client');
        const rows = (await lambdaClient.connector.listForRun.query({
          agentId: target.agentId,
          topicId: target.topicId,
        })) as unknown as RunConnectorRow[];
        cache.set(key, rows);
        return rows;
      } catch (error) {
        console.warn('[runConnectors] listing failed, using the local lists:', error);
        return cache.get(key);
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, request);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RunConnectorRow[] | undefined>((resolve) => {
    timer = setTimeout(() => resolve(cache.get(key)), timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** Test helper: forget every listing. */
export const resetRunConnectors = () => {
  cache.clear();
  inflight.clear();
};
