import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

import type { GoalTraceSummary, GoalTrajectory, IGoalTraceStore } from '@lobechat/agent-tracing';
import debug from 'debug';

import { FileS3 } from '@/server/modules/S3';

const compressZstd = promisify(zstdCompress);
const decompressZstd = promisify(zstdDecompress);

const log = debug('lobe-server:goal-tracing:s3');

const TRACE_PREFIX = 'goal-traces';
const TRAJECTORY_SUFFIX = '.json.zst';
const ZSTD_CONTENT_TYPE = 'application/zstd';

/**
 * Canonical S3 key for a goal's finalized trajectory. A goal id is stable for
 * the life of the goal, so the key is derivable from it alone — no column has
 * to carry it, the same way `parseOperationId` reconstructs an operation's key.
 */
export const buildGoalTraceKey = (goalId: string): string =>
  `${TRACE_PREFIX}/${goalId}${TRAJECTORY_SUFFIX}`;

/**
 * S3-backed goal trajectories.
 *
 * One object per goal, accumulated through a partial exactly like an operation
 * snapshot. The read-modify-write per advance is the same trade the operation
 * store already makes per step: an advance costs seconds of coordinator work
 * and minutes of agent execution, so a compressed object round trip is noise.
 *
 * S3 paths:
 * - Final:   goal-traces/{goalId}.json.zst
 * - Partial: goal-traces/_partial/{goalId}.json.zst  (deleted on finalization)
 */
export class S3GoalTraceStore implements IGoalTraceStore {
  private readonly s3: FileS3;

  constructor() {
    this.s3 = new FileS3();
  }

  private partialKey(goalId: string): string {
    return `${TRACE_PREFIX}/_partial/${goalId}${TRAJECTORY_SUFFIX}`;
  }

  private async encode(value: unknown): Promise<Buffer> {
    return compressZstd(Buffer.from(JSON.stringify(value)));
  }

  private async decode<T>(bytes: Uint8Array): Promise<T> {
    const buffer = await decompressZstd(Buffer.from(bytes));
    return JSON.parse(buffer.toString('utf8')) as T;
  }

  async save(trajectory: GoalTrajectory): Promise<void> {
    const key = buildGoalTraceKey(trajectory.goalId);
    log('saving goal trajectory to S3: %s', key);
    await this.s3.uploadBuffer(key, await this.encode(trajectory), ZSTD_CONTENT_TYPE);
  }

  async get(goalId: string): Promise<GoalTrajectory | null> {
    try {
      return await this.decode<GoalTrajectory>(
        await this.s3.getFileByteArray(buildGoalTraceKey(goalId)),
      );
    } catch {
      return null;
    }
  }

  // Listing means scanning a prefix; the CLI resolves goals through the
  // database instead, the same way it lists operations.
  async list(): Promise<GoalTraceSummary[]> {
    return [];
  }

  async listPartials(): Promise<string[]> {
    return [];
  }

  async loadPartial(goalId: string): Promise<Partial<GoalTrajectory> | null> {
    try {
      return await this.decode<Partial<GoalTrajectory>>(
        await this.s3.getFileByteArray(this.partialKey(goalId)),
      );
    } catch {
      return null;
    }
  }

  async savePartial(goalId: string, partial: Partial<GoalTrajectory>): Promise<void> {
    await this.s3.uploadBuffer(
      this.partialKey(goalId),
      await this.encode(partial),
      ZSTD_CONTENT_TYPE,
    );
  }

  async removePartial(goalId: string): Promise<void> {
    await this.s3.deleteFile(this.partialKey(goalId)).catch(() => {});
  }
}
