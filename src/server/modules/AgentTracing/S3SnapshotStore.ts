import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';
import debug from 'debug';

import { FileS3 } from '@/server/modules/S3';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const log = debug('lobe-server:agent-tracing:s3');

const TRACE_PREFIX = 'agent-traces';
const SNAPSHOT_SUFFIX = '.json.zst';
const LEGACY_SUFFIX = '.json';
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

  private legacyPartialKey(operationId: string): string {
    return `${TRACE_PREFIX}/_partial/${operationId}${LEGACY_SUFFIX}`;
  }

  private async encodeSnapshot(value: unknown): Promise<Buffer> {
    return compressZstd(Buffer.from(JSON.stringify(value)));
  }

  private async decodeSnapshot<T>(bytes: Uint8Array): Promise<T> {
    const buf = await decompressZstd(Buffer.from(bytes));
    return JSON.parse(buf.toString('utf8')) as T;
  }

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    const agentId = snapshot.agentId ?? 'unknown';
    const topicId = snapshot.topicId ?? 'unknown';
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

  async loadPartial(operationId: string): Promise<Partial<ExecutionSnapshot> | null> {
    // Current format: .json.zst (zstd-compressed)
    try {
      const bytes = await this.s3.getFileByteArray(this.partialKey(operationId));
      return await this.decodeSnapshot<Partial<ExecutionSnapshot>>(bytes);
    } catch {
      // fall through to legacy
    }
    // Legacy format: uncompressed .json. Kept to bridge in-flight partials across the
    // deploy window — partials are deleted on finalization so this branch dies off
    // naturally once the longest-running operation completes.
    try {
      const content = await this.s3.getFileContent(this.legacyPartialKey(operationId));
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      return null;
    }
  }

  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>): Promise<void> {
    const compressed = await this.encodeSnapshot(partial);
    await this.s3.uploadBuffer(this.partialKey(operationId), compressed, ZSTD_CONTENT_TYPE);
  }

  async removePartial(operationId: string): Promise<void> {
    // Clean up both the current key and any legacy uncompressed sibling that may
    // exist if the operation was started before the zstd rollout.
    await Promise.allSettled([
      this.s3.deleteFile(this.partialKey(operationId)),
      this.s3.deleteFile(this.legacyPartialKey(operationId)),
    ]);
  }
}
