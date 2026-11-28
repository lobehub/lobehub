import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import {
  type ExecutionSnapshot,
  type ISnapshotStore,
  parseOperationId,
  type PartialSaveOptions,
  type PartialSaveResult,
  type SnapshotSummary,
} from '@lobechat/agent-tracing';
import debug from 'debug';

import { FileS3 } from '@/server/modules/S3';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const log = debug('lobe-server:agent-tracing:s3');

/** A conditional write the store refused because the object changed underneath. */
const isPreconditionFailed = (error: unknown): boolean => {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return status === 412 || (error as { name?: string })?.name === 'PreconditionFailed';
};

const TRACE_PREFIX = 'agent-traces';
const SNAPSHOT_SUFFIX = '.json.zst';
const ZSTD_CONTENT_TYPE = 'application/zstd';

/**
 * Canonical S3 key for a finalized operation snapshot. Single source of truth
 * for the layout — both this store's `save()` and the DB-persistence path
 * (CompletionLifecycle) build keys through this helper so the value written to
 * `agent_operations.trace_s3_key` stays aligned with the object actually put
 * in S3.
 */
export const buildFinalSnapshotKey = (
  agentId: string,
  topicId: string,
  operationId: string,
): string => `${TRACE_PREFIX}/${agentId}/${topicId}/${operationId}${SNAPSHOT_SUFFIX}`;

/**
 * S3-backed snapshot store for production agent trace persistence.
 *
 * S3 paths:
 * - Final:   agent-traces/{agentId}/{topicId}/{operationId}.json.zst
 * - Partial: agent-traces/_partial/{operationId}.json.zst  (temporary, deleted after finalization)
 *
 * Snapshots are zstd-compressed (level 3) before upload — measured 8-9× average
 * size reduction across production traces. The `.zst` suffix is the format
 * indicator; Content-Encoding is intentionally NOT set so the object is served
 * as opaque bytes (avoids HTTP middleware auto-decompressing into clients that
 * don't expect it). Readers explicitly decompress.
 *
 * Partial snapshots are needed because QStash executes each step in a
 * separate HTTP request (no shared memory). Step data is accumulated
 * via S3 read-modify-write per step, then finalized on completion.
 * The overhead (~100ms per step) is negligible vs LLM call time.
 */
export class S3SnapshotStore implements ISnapshotStore {
  private readonly s3: FileS3;

  constructor() {
    this.s3 = new FileS3();
  }

  private partialKey(operationId: string): string {
    return `${TRACE_PREFIX}/_partial/${operationId}${SNAPSHOT_SUFFIX}`;
  }

  private async encodeSnapshot(value: unknown): Promise<Buffer> {
    return compressZstd(Buffer.from(JSON.stringify(value)));
  }

  private async decodeSnapshot<T>(bytes: Uint8Array): Promise<T> {
    const buf = await decompressZstd(Buffer.from(bytes));
    return JSON.parse(buf.toString('utf8')) as T;
  }

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    // Recover agentId/topicId from the operationId when the snapshot lacks them,
    // so the key matches what readers reconstruct from the operationId. Only an
    // operationId that doesn't carry the segments falls through to "unknown".
    const parsedOp = parseOperationId(snapshot.operationId);
    const agentId = snapshot.agentId ?? parsedOp?.agentId ?? 'unknown';
    const topicId = snapshot.topicId ?? parsedOp?.topicId ?? 'unknown';
    const key = buildFinalSnapshotKey(agentId, topicId, snapshot.operationId);

    log('Saving snapshot to S3: %s', key);
    const compressed = await this.encodeSnapshot(snapshot);
    await this.s3.uploadBuffer(key, compressed, ZSTD_CONTENT_TYPE);
  }

  // === Query methods — not supported, use OTEL backend ===

  async get(_traceId: string): Promise<ExecutionSnapshot | null> {
    return null;
  }

  async getLatest(): Promise<ExecutionSnapshot | null> {
    return null;
  }

  async list(_options?: { limit?: number }): Promise<SnapshotSummary[]> {
    return [];
  }

  // === Partial methods — S3 read-modify-write for QStash cross-request accumulation ===

  async listPartials(): Promise<string[]> {
    return [];
  }

  /**
   * Only the zstd key is read. The uncompressed `.json` fallback bridged
   * partials across the May 2026 zstd rollout (#14807); every run's first
   * step, which finds no partial yet, paid a second miss for it.
   */
  async loadPartial(operationId: string): Promise<Partial<ExecutionSnapshot> | null> {
    try {
      const bytes = await this.s3.getFileByteArray(this.partialKey(operationId));
      return await this.decodeSnapshot<Partial<ExecutionSnapshot>>(bytes);
    } catch {
      return null;
    }
  }

  async savePartial(
    operationId: string,
    partial: Partial<ExecutionSnapshot>,
    options?: PartialSaveOptions,
  ): Promise<PartialSaveResult> {
    const compressed = await this.encodeSnapshot(partial);
    try {
      const result = await this.s3.uploadBuffer(
        this.partialKey(operationId),
        compressed,
        ZSTD_CONTENT_TYPE,
        undefined,
        { abortSignal: options?.signal, ifMatch: options?.expected },
      );
      return { token: result?.ETag };
    } catch (error) {
      // A refused conditional write is an answer, not a failure: the caller's
      // cached copy is behind and it has to re-read before writing again.
      if (options?.expected && isPreconditionFailed(error)) return { conflict: true };
      throw error;
    }
  }

  async removePartial(operationId: string): Promise<void> {
    // Cleanup only: a partial left behind never blocks the finalized trace.
    await this.s3.deleteFile(this.partialKey(operationId)).catch(() => {});
  }
}
