import { getCacheScope } from '@/libs/swr/useCacheScope';
import { ragService } from '@/services/rag';
import { isTrpcErrorCode } from '@/utils/trpcError';

const WAIT_MS = 5_000;
const RETRY_AFTER_MS = 5 * 60_000;
const PARSE_FAILED = 'The file is attached but its contents could not be extracted.';
const STILL_PROCESSING =
  'The file is attached but is still being processed; its contents are not available for this message.';

type Settlement = 'aborted' | 'failed' | 'ready';
type WaitResult = Settlement | 'timeout';
type Waiters = Set<(result: Settlement) => void>;
interface PendingParse {
  agentIds: Set<string>;
  waiters: Waiters;
}

const waitForParse = (waiters: Waiters, signal?: AbortSignal): Promise<WaitResult> =>
  new Promise((resolve) => {
    const finish = (result: WaitResult) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      waiters.delete(finish);
      resolve(result);
    };
    const onAbort = () => finish('aborted');
    const timeout = setTimeout(() => finish('timeout'), WAIT_MS);

    waiters.add(finish);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) finish('aborted');
  });

export class KnowledgeFileHydration {
  readonly #pending = new Map<string, PendingParse>();
  readonly #retryAt = new Map<string, number>();

  constructor(
    private readonly cacheContent: (
      agentIds: ReadonlySet<string>,
      fileId: string,
      content: string,
    ) => void,
  ) {}

  async hydrate(
    agentId: string,
    fileIds: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    const errors = new Map<string, string>();
    if (signal?.aborted || fileIds.length === 0) return errors;

    const scope = getCacheScope();
    await Promise.all(
      fileIds.map(async (fileId) => {
        const key = JSON.stringify([scope, fileId]);
        if ((this.#retryAt.get(key) ?? 0) > Date.now()) {
          errors.set(fileId, PARSE_FAILED);
          return;
        }
        this.#retryAt.delete(key);

        const pending = this.#pending.get(key) ?? this.#startParse(key, fileId, scope);
        pending.agentIds.add(agentId);
        const result = await waitForParse(pending.waiters, signal);
        if (result === 'failed') errors.set(fileId, PARSE_FAILED);
        if (result === 'timeout') errors.set(fileId, STILL_PROCESSING);
      }),
    );

    return signal?.aborted || getCacheScope() !== scope ? new Map() : errors;
  }

  #startParse(key: string, fileId: string, scope: string): PendingParse {
    const pending: PendingParse = { agentIds: new Set(), waiters: new Set() };
    this.#pending.set(key, pending);

    const settle = (result: Settlement) => {
      this.#pending.delete(key);
      for (const waiter of pending.waiters) waiter(result);
    };

    // The request outlives individual sends; a late result can warm the cache.
    void ragService.parseFileContent(fileId).then(
      (document) => {
        const currentScope = getCacheScope() === scope;
        settle(currentScope ? 'ready' : 'aborted');
        if (currentScope) this.cacheContent(pending.agentIds, fileId, document.content ?? '');
      },
      (error: unknown) => {
        const denied =
          isTrpcErrorCode(error, 'FORBIDDEN') || isTrpcErrorCode(error, 'UNAUTHORIZED');
        this.#retryAt.set(key, denied ? Infinity : Date.now() + RETRY_AFTER_MS);
        console.error('[AgentStore] Failed to parse knowledge file:', fileId, error);
        settle('failed');
      },
    );

    return pending;
  }
}
