import type { ExecutionSnapshot, ISnapshotStore, SnapshotSummary } from '@lobechat/agent-tracing';
import debug from 'debug';

import { FileS3 } from '@/server/modules/S3';

const log = debug('lobe-server:agent-tracing:s3');

const TRACE_PREFIX = 'agent-traces';

/**
 * S3-backed snapshot store for production agent trace persistence.
 *
 * S3 paths:
 * - Final:   agent-traces/{agentId}/{topicId}/{operationId}.json
 * - Partial: agent-traces/_partial/{operationId}.json  (temporary, deleted after finalization)
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
    return `${TRACE_PREFIX}/_partial/${operationId}.json`;
  }

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    const agentId = snapshot.agentId ?? 'unknown';
    const topicId = snapshot.topicId ?? 'unknown';
    const key = `${TRACE_PREFIX}/${agentId}/${topicId}/${snapshot.operationId}.json`;

    log('Saving snapshot to S3: %s', key);
    await this.s3.uploadContent(key, JSON.stringify(snapshot));
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
    try {
      const content = await this.s3.getFileContent(this.partialKey(operationId));
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      return null;
    }
  }

  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>): Promise<void> {
    await this.s3.uploadContent(this.partialKey(operationId), JSON.stringify(partial));
  }

  async removePartial(operationId: string): Promise<void> {
    try {
      await this.s3.deleteFile(this.partialKey(operationId));
    } catch {
      // ignore — partial may already be cleaned up
    }
  }
}
