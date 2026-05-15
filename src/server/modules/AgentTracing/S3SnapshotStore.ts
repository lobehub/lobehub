import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';
import debug from 'debug';

import { FileS3 } from '@/server/modules/S3';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const log = debug('lobe-server:agent-tracing:s3');

const TRACE_PREFIX = 'agent-traces';
const ZSTD_SUFFIX = '.json.zst';
const PLAIN_SUFFIX = '.json';
const ZSTD_CONTENT_TYPE = 'application/zstd';
const PLAIN_CONTENT_TYPE = 'application/json';

// Compress on production deployments only — local dev (even when opting into
// S3 via ENABLE_AGENT_S3_TRACING=1) keeps writing plain `.json` so devs can
// inspect the raw payload directly from the bucket.
const COMPRESS_SNAPSHOTS = process.env.NODE_ENV === 'production';

// zstd frame magic: 0x28 0xb5 0x2f 0xfd. Used to auto-detect the body format
// regardless of which environment wrote it, so a prod-written `.json.zst` and
// a dev-written `.json` both round-trip through the same reader.
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
const isZstdFrame = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === ZSTD_MAGIC[0] &&
  bytes[1] === ZSTD_MAGIC[1] &&
  bytes[2] === ZSTD_MAGIC[2] &&
  bytes[3] === ZSTD_MAGIC[3];

/**
 * S3-backed snapshot store for production agent trace persistence.
 *
 * S3 paths:
 * - Final:   agent-traces/{agentId}/{topicId}/{operationId}{.json|.json.zst}
 * - Partial: agent-traces/_partial/{operationId}{.json|.json.zst}  (temporary, deleted after finalization)
 *
 * Production deployments (NODE_ENV=production) zstd-compress snapshots before
 * upload — measured 8-9× average size reduction. The `.zst` suffix is the format
 * indicator; Content-Encoding is intentionally NOT set so the object is served
 * as opaque bytes (avoids HTTP middleware auto-decompressing into clients that
 * don't expect it).
 *
 * Local dev keeps writing plain `.json` for easy bucket inspection. Readers
 * sniff the zstd magic bytes (0x28b52ffd) to handle either format transparently.
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

  private get activeSuffix(): string {
    return COMPRESS_SNAPSHOTS ? ZSTD_SUFFIX : PLAIN_SUFFIX;
  }

  private get legacySuffix(): string {
    return COMPRESS_SNAPSHOTS ? PLAIN_SUFFIX : ZSTD_SUFFIX;
  }

  private partialKey(operationId: string, suffix: string = this.activeSuffix): string {
    return `${TRACE_PREFIX}/_partial/${operationId}${suffix}`;
  }

  private async encodeSnapshot(value: unknown): Promise<{ body: Buffer; contentType: string }> {
    const json = Buffer.from(JSON.stringify(value));
    if (!COMPRESS_SNAPSHOTS) return { body: json, contentType: PLAIN_CONTENT_TYPE };
    return { body: await compressZstd(json), contentType: ZSTD_CONTENT_TYPE };
  }

  private async decodeSnapshot<T>(bytes: Uint8Array): Promise<T> {
    const json = isZstdFrame(bytes)
      ? (await decompressZstd(Buffer.from(bytes))).toString('utf8')
      : Buffer.from(bytes).toString('utf8');
    return JSON.parse(json) as T;
  }

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    const agentId = snapshot.agentId ?? 'unknown';
    const topicId = snapshot.topicId ?? 'unknown';
    const key = `${TRACE_PREFIX}/${agentId}/${topicId}/${snapshot.operationId}${this.activeSuffix}`;

    log('Saving snapshot to S3: %s', key);
    const { body, contentType } = await this.encodeSnapshot(snapshot);
    await this.s3.uploadBuffer(key, body, contentType);
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
    // Try the active key first (matches whatever this process writes), then the
    // sibling format. Covers prod↔dev round-trips and the deploy window when an
    // in-flight partial may have been written by the previous binary.
    for (const suffix of [this.activeSuffix, this.legacySuffix]) {
      try {
        const bytes = await this.s3.getFileByteArray(this.partialKey(operationId, suffix));
        return await this.decodeSnapshot<Partial<ExecutionSnapshot>>(bytes);
      } catch {
        // try next
      }
    }
    return null;
  }

  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>): Promise<void> {
    const { body, contentType } = await this.encodeSnapshot(partial);
    await this.s3.uploadBuffer(this.partialKey(operationId), body, contentType);
  }

  async removePartial(operationId: string): Promise<void> {
    // Clean up both possible siblings — covers cross-env round-trips and the
    // deploy window where a previous binary may have written the other format.
    await Promise.allSettled([
      this.s3.deleteFile(this.partialKey(operationId, ZSTD_SUFFIX)),
      this.s3.deleteFile(this.partialKey(operationId, PLAIN_SUFFIX)),
    ]);
  }
}
